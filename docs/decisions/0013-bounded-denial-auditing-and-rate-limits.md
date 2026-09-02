# 0013 — Bounded denial auditing: aggregation, rate limits, and reserved D1 capacity

- **Status:** **Accepted**
- **Date:** 2026-09-02
- **Deciders:** **User** (explicit written decision, 2026-09-02), Dudo Team Lead
- **Owning agent:** Team Lead records. Implemented by `core-agent`.

## Context

`0012`'s sibling problem, found the same way — by an agent refusing to let a number stand
unexamined.

The user's D2 decision (2026-09-02) made every **denied** read an audit write, closing a real
hole: a cross-tenant probing campaign run through `GetCustomer` had produced **zero** audit
records while the same campaign through `ArchiveCustomer` produced one per attempt.

`core-agent` then observed that nothing rate-limits an authenticated caller, so each denial is
a D1 write the attacker chooses the rate of. While investigating, it found an allowance the
free-tier register did not have. Verified by the Team Lead against
`developers.cloudflare.com/d1/platform/pricing/` — **it is not on the `limits/` page the
register cites, which is why it was missed:**

- **5,000,000 rows read per day**
- **100,000 rows written per day**

> "When your account hits the daily read and/or write limits, you will not be able to run
> queries against D1. D1 API will return errors to your client indicating that your daily
> limits have been exceeded."

**Account-wide. Not per-database, not per-tenant.**

So the probe-detection control was a **platform-wide denial-of-service lever**: one
authenticated caller, 100,000 malformed requests in a day, and D1 stops answering for every
Organization. The cheapest denial to produce needs no valid customer id at all.

The control had become the vulnerability — the third time in this slice, after the audit-log
existence oracle and the enrich-from-target trap.

## Decision

Ten binding controls, decided by the user on 2026-09-02.

### Aggregation replaces per-attempt writes

1. **Per-attempt D1 audit writes are replaced by bounded aggregation.**
2. **A SQLite-backed Durable Object** is the denial counter and coordinator.
3. Events group by **actor + Organization + action + denial category + time window**.
4. **One summarised D1 record per 15-minute window**, carrying: first attempt time, last
   attempt time, total attempt count, actor and Organization context, and the fixed safe
   denial category.
5. **Do not group by requested customer identifier.** An attacker controls that value and
   could mint unlimited groups, which would restore per-attempt writes under another name.
   This is the constraint that makes the aggregation actually bounded.

### Rate limits, applied before D1 is touched

6. Rate limits are enforced **before any Customer D1 query**, at three levels: per
   authenticated actor, per Organization, and **per source IP as a fallback**.
7. **Malformed identifiers are rejected before querying D1.** That path was the cheapest
   denial to produce and it must cost nothing downstream.

### Fail-closed, and reserved capacity

8. **Failure or exhaustion of the audit coordinator must never permit access**, and must not
   change the external `not_found`. The caller cannot tell the coordinator is degraded, and
   degradation never widens what is reachable.
9. **A strict daily ceiling on audit-summary writes reserves D1 capacity** for Customer and
   Business traffic. Security evidence must not be able to starve the product.

### The gate

10. **`AZ2` cannot be accepted until these controls and their fail-closed behaviour are
    implemented.** Authentication is what makes the exposure live; the bound has to exist
    first.

## What this does NOT claim

11. **This is not DDoS resistance, and must never be described as such.** An attacker can
    still exhaust Cloudflare's overall **Workers Free request allowance** — 100,000
    requests/day — before ever reaching D1. These controls protect **D1 capacity and the
    integrity of the audit trail**. They do not make Dudo resistant to a volumetric attack,
    and no report, standard or PR may imply otherwise.

## Consequences

- **The audit trail changes shape.** A denial is no longer one row. Anything reading audit
  records — alerting, QA assertions, the contract's §12 obligations — must be revisited
  against summaries. QA's per-attempt assertions (the 25-attempt campaign case producing 25
  records) will correctly go red and must be rewritten, not weakened.
- **Durable Objects enter the architecture for the first time.** `0003` approved them "only
  where real coordination is needed"; a cross-request counter is exactly that. `0008` permits
  **SQLite-backed only** on Free — KV-backed requires a paid plan and is prohibited. The
  user specified SQLite-backed, consistent with both.
- **A free-tier impact check is owed for the Durable Object itself**, which has its own
  daily limits: 100,000 requests, 13,000 GB-s, 5M rows read, 100k rows written, 5 GB stored.
  Moving writes off D1 does not make them free — it moves them onto a different, separately
  metered allowance, and that allowance must be measured rather than assumed generous.
- **The window is a detection-latency trade.** Fifteen minutes means a campaign is visible
  within fifteen minutes, not instantly. That is the accepted cost of bounding the writes.
- **`0011` and `0012`'s pattern repeats and should be noted:** all three defects were found
  by an implementing agent declining to accept a value or a limit at face value, and none was
  found by review.

## Two documented exceptions to `CLOUDFLARE_STANDARD.md` §7 rule 3

§7 rule 3 requires that **a Durable Object instance belongs to exactly one tenant.** This
design takes two deliberate exceptions to it, recorded here rather than by amending the
standard — the standard is right in general and stands as written.

**1. The `SourceCounterShard` is cross-tenant by necessity.** A source address is not a
tenant-scoped fact. The whole reason the third rate-limit level exists is to see what the
actor and Organization levels cannot: one address operating across many Organizations. A
per-tenant shard could not observe that, and the first implementation proved it — the level
was unreachable precisely because its state was partitioned per Organization. Deployed as 256
instances named by the first byte of the address hash.

**2. The platform-wide daily summary-write ceiling is cross-tenant by necessity.** It exists
to stop denial evidence exhausting an **account-wide** D1 allowance. A per-tenant ceiling
cannot bound an account-wide resource.

**What makes both acceptable, and it is the same argument:** neither holds tenant data. The
shard holds a hashed address, a window, and an integer — no Organization identifier, no
principal, no record, and no column any of those could occupy. It cannot leak which
Organizations an address touched, because it is never told.

**What they do create, named rather than dismissed:** an **availability coupling** between
Organizations sharing a source address — traffic from one consumes budget another draws on.
That is inherent to address-based limiting, and it is why this level carries the loosest
threshold and sits **last** in the refusal order. The weak inference a refused caller gains is
*"roughly 600 requests came from my address this minute, some possibly not mine"* — a
statement about an address, not a tenant. It names no other Organization and confirms none
exists.

**An unreachable shard does not block.** The actor and Organization levels still bound every
request, so the level degrades to two-level behaviour rather than refusing every user behind a
NAT on no evidence. That is deliberately **not** the `begin()` failure path, which degrades to
read-only.

## Approval

Decided by the user in writing on 2026-09-02, in twelve numbered points including the
explicit instruction not to claim DDoS resistance and to record the residual risk honestly.
Sequenced after the Business table (`PR #6`), in its own focused PR. `PR #5` is merged and is
not reopened.

Related: `0003` (Durable Objects, only where coordination is genuinely needed); `0008`
(zero-cost, SQLite-backed Durable Objects only); the D2 decision of 2026-09-02; scheduled
item 10, which this record closes.
