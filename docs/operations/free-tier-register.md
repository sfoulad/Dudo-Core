# Free-tier usage register

Binding under `docs/decisions/0008-zero-cost-mvp-infrastructure.md`. Dudo's Cloudflare and
GitHub cost must remain **USD 0 / BD 0 per month**.

**Re-verify every limit before every release.** Provider allowances change, and a number
quoted from memory is worse than no number because it will be trusted.

## Thresholds

| Threshold | Action |
|---|---|
| **70%** | Warning |
| **85%** | Stop non-essential and background usage |
| **90%** | Block further metered growth and **notify the user** |

**On the production shared tenant-data database these thresholds have a specific meaning**
(`docs/decisions/0006-tenancy-model.md` §0.4, Accepted): 70% is a warning and a capacity
review; **85% stops onboarding new Organizations** and stops non-essential and background
growth; 90% is an emergency capacity gate that preserves the remaining headroom for
essential operations for existing customers.

**Never delete financial, audit, or customer data merely to remain free.** If the choice is
between a charge and destroying a customer's records, it is not a choice: stop onboarding,
degrade non-essential service, and escalate to the user. Retention deletion under a stated
policy is a different thing and is unaffected.

## Register

Current usage is **0** for every row: no Cloudflare resource has been created, and no
workflow exists. `Last verified` is the date the *allowance* was checked against the
official source, not the date usage was measured.

| Service | Source | Free allowance | Expected MVP usage | Current | Warn (70%) | Hard stop | Owner | Last verified |
|---|---|---|---|---|---|---|---|---|
| **D1 — databases** | `developers.cloudflare.com/d1/platform/limits/` | **10 per account** | **4 allocated of 10** — 1 control-plane/tenant directory (**now schema-defined by `0014` §C: principal, organization, organization_membership, session, tenant_directory — slot 1 was already reserved for it, so this is not a fifth database**), 2 production shared tenant data, 3 combined staging, 4 reserved migration/recovery; 5–10 unallocated reserve (`0006` §0.3). Local dev and CI consume **no** remote slots | 0 | 7 | Refuse to create an 11th; degrade rather than upgrade | core-agent | 2026-09-02 |
| **D1 — size per database** | same | **500 MB** | **Production shared tenant-data database: 500 MB ceiling.** One shared database holds every Organization's business data (`0006` §0.1). Files and large exports go to R2, never here | 0 | 350 MB (70%) | 425 MB (85%) stop onboarding new Organizations; 450 MB (90%) emergency gate — essential existing-customer operations only. **Never delete financial, audit, or customer data to stay free** | core-agent | 2026-09-01 |
| **D1 — total storage** | same | **5 GB** | Sum of the 4 allocated databases; production shared DB is the dominant consumer | 0 | 3.5 GB | Block further growth, notify user | core-agent | 2026-09-01 |
| D1 — queries per invocation | same | 50 | < 50 by design | 0 | 35 | Fail the request, do not batch around it | core-agent | 2026-09-01 |
| **D1 — rows READ per day** | `developers.cloudflare.com/d1/platform/pricing/` | **5,000,000 / day** | Point lookups and bounded pages by design | 0 | 3.5M | **Queries FAIL account-wide — not billed.** See the warning below | core-agent | **2026-09-02** |
| **D1 — rows WRITTEN per day** | same | **100,000 / day** | **Governed by `0014` §A: Dudo admits at most 80,000 estimated row-writes/day, leaving 20,000 as margin that is NOT spendable.** Split 60,000 business · 10,000 security · 10,000 system | 0 | 70,000 | **Queries FAIL account-wide — not billed.** Every writer reserves worst-case cost through one admission port; direct D1 writes outside it cannot be expressed | core-agent | **2026-09-03** |
| **D1 — Dudo's business allocation** | `0014` §A.5 | **60,000 / day** of the 80,000 | Customer mutations and their audit rows. **A Customer create costs 8** — D1 bills an index row per indexed column, so `customer` 3 + `audit_event` 5. Per-Organization ceiling **10,000/day → 1,250 creates** | 0 | 42,000 | `429` + retry time; **reads stay available** | core-agent | **2026-09-03** |
| **D1 — Dudo's security allocation** | `0013`, `0014` §A.5 | **10,000 / day** | Denial summaries. Four all-day campaigns commit 9,216 of it | 0 | 7,000 | Writes stop, counting continues, **caller's response unchanged** — deliberately not a refusal | core-agent | **2026-09-03** |
| **D1 — Dudo's system allocation** | `0014` §A.5 | **10,000 / day** | **Control-plane sub-ceiling 3,000** (600 per principal) → **1,000 logins/day platform-wide, 200 per principal**, at 3 row-writes per session. Session *retention purging* draws on the same allocation: at saturation the session lifecycle is **6,000 of 10,000**, leaving ~4,000 for migrations and emergency work | 0 | 7,000 | `429` + retry time. **The purge is unbuilt — budget it before writing it, or the first retention job discovers the ceiling** | core-agent | **2026-09-03** |
| D1 — Time Travel | same | 7 days | 7 days | 0 | n/a | Recovery window is 7 days, not more | core-agent | 2026-09-01 |
| **Workers — requests** | `developers.cloudflare.com/workers/platform/limits/` | **100,000 / day** | Core API + web backend | 0 | 70,000 | **Exceeding returns Error 1027 — requests rejected, NO automatic charge.** The route's behaviour is **configurable**, fail-open or fail-closed, and **fail-closed is NOT the Cloudflare default — Dudo must set it explicitly on every route.** Until it is set, the route falls back to Cloudflare's default behaviour, which is not the behaviour this register assumes | core-agent | 2026-09-01 |
| **Workers — CPU / memory / count / subrequests** | same | **10 ms per request · 128 MB per isolate · 100 Workers · 50 subrequests per invocation** | **10 ms is an architectural constraint, not a tuning target — and it caps authentication design.** Measured WebCrypto cost: PBKDF2-SHA256 at OWASP's recommended **600,000 iterations takes ~72 ms, 7× the entire budget**; only ~60,000 fit, one tenth of the recommendation. ECDSA P-256 verify is **0.09 ms** and HMAC-SHA256 verify **0.011 ms**. **So the CPU ceiling caps password-hashing strength structurally, while signature-based credentials cost ~1% of the budget** | 0 | n/a | Invocation terminated; stream rather than buffer; bound fan-out | Team Lead | **2026-09-03** |
| **R2 — storage / ops** | `developers.cloudflare.com/r2/pricing/` | **10 GB-month · 1M Class A · 10M Class B · egress FREE** | Files, attachments, large exports (never D1) | 0 | 7 GB / 700k / 7M | ⚠ **Cloudflare's own documentation states the allowances but is SILENT on overage** — re-verified 2026-09-01 against `r2/pricing/`, which says only *"you can use the following amount of storage and operations each month for free"* and *"the free tier only applies to Standard storage"*. It does **not** say whether exceeding it blocks or bills. **Dudo therefore enforces its own ceiling and stops writing before the allowance is reached** | core-agent | 2026-09-01 |
| **Queues** | `developers.cloudflare.com/queues/platform/limits/` | **Available on Workers Free.** 128 KB message · 10,000 queues · **24 h retention, not configurable on Free** | Async events | 0 | n/a | **Design for 24 h retention.** A message that must outlive it needs a durable record, not a queue. Reference large payloads in R2 | core-agent | 2026-09-01 |
| **Workflows** | `developers.cloudflare.com/workflows/reference/limits/` | **Available on Workers Free.** 100 concurrent · 1,024 steps · 10 ms per step · 100 MB state · **100,000 executions/day SHARED with the Workers daily limit** | Long-running processes | 0 | shares the Workers 70,000 warn | **Counts against the Workers row — budget them together, not separately.** Same Error 1027 path | core-agent | 2026-09-01 |
| **Durable Objects** | `developers.cloudflare.com/durable-objects/platform/pricing/` | **SQLite-backed ONLY on Free** (KV-backed requires a paid plan). 100,000 req/day · 13,000 GB-s/day · 5M rows read · 100k rows written · 5 GB stored | **Only where genuine coordination is required** (`0003`) | 0 | 70% of each | **SQLite backend only — never KV-backed.** Refuse new namespaces at the warn line | core-agent | 2026-09-01 |
| **GitHub Actions — public repos** | `docs.github.com` Actions billing | **Free, unmetered** on standard runners | Dudo-Core, Dudo-Apple CI | 0 | n/a | Never use a larger runner | Team Lead | 2026-09-01 |
| **GitHub Actions — private (Dudo-Plan)** | same | **2,000 min/mo · 500 MB artifacts · 10 GB cache** | Minimal; docs only | 0 | 1,400 min / 350 MB | Disable workflows in that repo | Team Lead | 2026-09-01 |
| **CodeRabbit** | `coderabbit.ai/pricing` | **PUBLISHED OFFER ONLY:** published as free for public repositories; verified against the pricing page on 2026-09-01. **Subject to provider terms and to separate account-level verification.** This is the advertised offer, **not** evidence about Dudo's account | Automated PR review on `Dudo-Core`. **Active**: real reviews completed on `c09693f`, `477753f`, `1b8e2fa`, `685b99e`, `3cc5018` | active — **account plan UNVERIFIED** | n/a | Rate limiting only, which is **acceptable and must never trigger an upgrade**. **Dudo's own plan, billing status, paid add-ons and spending configuration remain UNVERIFIED** — C5 / B-CodeRabbit, blocked on user dashboard evidence | Team Lead | Offer 2026-09-01; **account state not verified** |
| **GitHub Packages** | `docs.github.com` billing | Free allowance exists; **not used and not planned** | **None planned** | 0 | n/a | Do not publish packages. Not verified in detail because it is prohibited, not merely unused | Team Lead | 2026-09-01 (prohibited) |
| **GitHub Codespaces** | `docs.github.com` billing | Free allowance exists; **not used and not planned** | **None planned** | 0 | n/a | Do not use. Prohibited by `0008` | Team Lead | 2026-09-01 (prohibited) |

> ## ⚠ THE DURABLE OBJECT BUDGET IS SHARED, AND THAT IS A HAZARD, NOT AN ALLOWANCE
>
> Added 2026-09-04 from `0017`. The Durable Objects row above states **100,000 requests/day**
> correctly. What it did not state is that the figure is **account-wide and shared**, and that the
> sharing has a specific failure mode.
>
> `0013`'s coordinator serves the **authenticated** path. A durable pre-auth rate limiter would
> serve the **unauthenticated** one. A naive one-DO-call-per-request limiter therefore lets **an
> unauthenticated flood exhaust the allowance the authenticated path depends on** — the rate
> limiter becomes the denial-of-service vector it was added to prevent.
>
> **Consequence for §6a:** a free-tier impact check on a new Durable Object may not stop at "does
> it fit inside 100,000". It must state **which other consumer it shares with, and what happens to
> that consumer at the limit.** "Add a DO" is not a design.
>
> `0017` defers the durable limiter for exactly this reason. The deferral is not a scheduling
> convenience — the capacity question is genuinely unanswered.

> ## ⚠ THE LOGIN BUDGET IS A CYCLE, NOT A LOGIN
>
> Added 2026-09-04 from `0018`, measured by `core-agent` rather than estimated.
>
> `0014` §C's headline figure is **1,000 logins/day platform-wide** (3,000 control-plane row-writes
> at 3 per login) and 200 per principal. **Read alone, that number misleads by half.**
>
> **Logout costs 3 row-writes too.** A `DELETE` removes the row from every index, so the table row,
> the primary key and `session_by_principal` are each written — identical to a login.
>
> **CORRECTED 2026-09-05: A FULL SESSION COSTS 6 OR 9, DEPENDING ON HOW THE ORGANIZATION WAS
> SELECTED.** Selecting is **not optional** — `login.ts:219` records that a session is created
> `organization-not-selected` and every business Action answers `failed_precondition` until a
> selection is made (`0021`).
>
> **A full session costs 9 — login + select + logout — with no exception.**
>
> | | Charged per full cycle | Platform/day | Per principal/day |
> |---|---|---|---|
> | Login only (`0014` §C as written) | 3 | 1,000 | 200 |
> | Login + logout (`0018`) | 6 | 500 | 100 |
> | **Full session (`0021`)** | **9** | **333** | **66** |
>
> Selection is always a separate request: `0021` records that server-side auto-selection was ruled
> and then **withdrawn** — a client with one Organization may skip *showing a picker*, but the
> request is still made and the server still has no fallback.
>
> **This number has been published five times in two days: 1,000 → 500 → 333 → 6-or-9 → 333.**
>
> The first three corrections were measurement. **The last two were not.** They were one unsettled
> design question published twice as though it were arithmetic.
>
> **The rule this yields, and it is the useful part: a number that depends on an undecided design is
> not a number yet.** Publishing it as one converts an open question into apparent fact, and the
> eventual correction then looks like new evidence when it is really the design finally settling.
> Before quoting a figure from this register, check whether the behaviour it counts is decided.
>
> Verified in the harness: revocation reserves exactly 3, while a forged credential, an absent
> cookie, an unknown session and a replay each reserve **zero** — so failed logout attempts cannot
> be used to burn the budget.

> ## THE PLATFORM SURFACE — what the super-admin console costs
>
> Added 2026-09-05 from `0025` and `0027`. **Both designs are decided**, so by the rule stated
> immediately above these are numbers rather than estimates awaiting a design.
>
> | Operation | Control-plane row-writes | Platform/day against the 3,000 sub-ceiling |
> |---|---|---|
> | Any platform route (audit record, `0025` Decision 5) | **2** | — |
> | Onboarding an Organization (`0024`, `0025`) | **10** | **300** |
> | A confirmed critical operation (`0027`) | **+4** over the operation itself | ~**750** confirmations |
>
> **The onboarding figure corrects the code.** `control-plane-admission.ts` records **6**; the
> operation actually writes **10**. `0025`'s consequences flag this and the constant is still wrong
> in the source. **A budget constant that under-counts is worse than none** — it spends an allowance
> nobody is watching, and the failure mode is D1 refusing queries account-wide.
>
> **Why the confirmation cost is affordable for a structural reason rather than a lucky one:** a
> critical operation requires a human to read a statement and type a password, so **volume is
> bounded by human attention, not by traffic.** `0013` Control 5's test — *is the population that
> can force a write bounded by something other than the attacker?* — passes.
>
> **The hazard, named in `confirmation-v1` rather than discovered later:** both challenge routes are
> **writes reachable by any authenticated principal holding a critical permission**, at 2 row-writes
> each. An unbounded challenge loop spends the shared ceiling. **`0017`'s in-process limiter does
> not bound this in a deployed Worker**, because each isolate has its own — so the **durable rate
> limiter now has two consumers** (pre-auth and confirmation) and has stopped being a
> single-feature nicety.
>
> **Verified by execution 2026-09-05, not by reading:** `0008`–`0010` apply cleanly to a local D1,
> and all four mutual-exclusion triggers refuse in both directions on INSERT and UPDATE, with the
> negative controls passing — a principal with no platform row can still be given a membership, and
> a principal with no membership can still become an operator.

> ## ⚠ D1 DAILY ROW LIMITS ARE ENFORCED, AND EXCEEDING THEM IS AN OUTAGE — NOT A BILL
>
> Verified 2026-09-02 against `d1/platform/pricing/`. **These limits are not on the `limits/`
> page**, which is why this register missed them until `core-agent` found the gap while
> building the Business table.
>
> **5,000,000 rows read/day · 100,000 rows written/day**, and Cloudflare's own words on what
> happens: *"When your account hits the daily read and/or write limits, you will not be able
> to run queries against D1. D1 API will return errors to your client indicating that your
> daily limits have been exceeded."*
>
> **This is ACCOUNT-WIDE, not per-database and not per-tenant.** One Organization exhausting
> the daily write allowance takes D1 down for **every** Organization.
>
> **It interacts directly with D2 and raises that risk from cost to availability.** D2 makes
> every *denied read* a database write. An authenticated caller who probes 100,000 times in a
> day exhausts the account's entire write allowance and halts D1 for the whole platform. The
> probe-detection control becomes a platform-wide denial-of-service lever, and the attacker
> needs no valid identifier — a malformed one is audited too, and is the cheapest denial to
> produce.
>
> **Dormant only because production ships a deny-all principal resolver.** That is a
> deployment accident standing in for a control, and it expires the day AZ2 lands.
> `docs/decisions/README.md` scheduled item 10 is **blocking on AZ2** for this reason.
>
> Consistent with `0008`: the failure mode is fail-closed, so no charge is created. An outage
> is not a billing event — but it is not an acceptable one either.

> ## ⚠ R2 OVERAGE BEHAVIOUR IS UNDOCUMENTED — the one real cost risk in this register
>
> Cloudflare's pricing page states R2's free allowances but **does not state what happens
> when they are exceeded on an account with no paid plan.** Re-verified against the official
> page on 2026-09-01: it is silent on overage, on whether a payment method is required, and
> on whether service is blocked or billed. **This is a documented absence, not an assumption.** Contrast Workers, which
> documents Error 1027 and explicitly no automatic charge. Under a USD 0 constraint an
> undocumented overage path is a genuine risk.
>
> **Therefore Dudo enforces its own R2 ceiling in code and stops writing before the
> allowance is reached, rather than relying on the provider to refuse.** Confirm the
> billing behaviour with Cloudflare before R2 holds anything that matters.

### CodeRabbit — explicitly recorded under `0008`

- **Paid CodeRabbit plans and usage-based add-ons are PROHIBITED.** Paid tiers exist
  (Essentials $24, Team $48, Advanced $72 per developer/month) with optional usage-based
  add-ons such as per-file review charges. **These apply to private repositories only and
  must never be enabled.**
- **The CodeRabbit CLI must never accept a paid continuation prompt.** Decline and report.
- **Rate limiting is acceptable and must NEVER trigger an upgrade.** It occurred during
  Phase 0; the correct response was to wait, which is what was done.

**Local development and CI consume no remote D1 slots, and must not.** Verified against
Cloudflare's local-development documentation on 2026-09-01: `wrangler dev` defaults to
local mode powered by Miniflare and persists to local disk. Reaching a remote database
requires explicitly setting **`"remote": true`** in the binding configuration; local and CI
configuration must never set it (`CLOUDFLARE_STANDARD.md` §4.1).

**Time Travel is a whole-database 7-day window, not a per-tenant restore.** Under the
decided tenancy model one shared database holds every Organization, so restoring one
customer to a point in time is effectively unavailable — an accepted MVP limitation
(`0006` §0.7), not an operational gap to be discovered during an incident.

### CodeRabbit — two separate claims, never to be merged

`0008` covers "Cloudflare, GitHub, and GitHub-integrated development automation."
CodeRabbit is exactly that, is configured at the repository root, and is **already active**
— it completed real reviews during Phase 0 on `c09693f`, `477753f`, `1b8e2fa`, `685b99e`
and `3cc5018`.

Two claims are involved and they are **not** the same claim. Collapsing them is what
produced the contradiction a reviewer caught on `3cc5018`, where this register said the
plan was verified in one row and unverified six paragraphs later.

| | Claim | Status |
|---|---|---|
| **A** | **Published offer.** CodeRabbit advertises free use for public repositories | **VERIFIED** against the published pricing page, 2026-09-01 |
| **B** | **Dudo account state.** The actual plan, billing status, paid add-ons and spending configuration of the connected Dudo account | **UNVERIFIED** — pending user dashboard evidence, C5 / B-CodeRabbit |

**A does not evidence B.** A published offer is what a provider advertises to everyone; it
is not a statement about which plan this account is on, what payment instrument is
attached, or whether an add-on is active. Only the account owner can see B, and billing
pages are not readable through the available tooling.

**Do not write "FREE FOREVER" as an unconditional platform guarantee.** The accurate form
is: *published as free for public repositories; verified on 2026-09-01; subject to provider
terms and separate account-level verification.*

**Do not claim the account itself is verified free.** It is not, and **C5 stays BLOCKED**
until the user completes the Group B actions in `billing-guardrails.md`. Cost conditions
C1–C3 cannot be evidenced for CodeRabbit's account state either, for the same reason.

**Rows marked `unverified` have not been checked against their official source.** They
carry no number because `CLOUDFLARE_STANDARD.md` §10 forbids quoting an unverified limit.
They must be verified before the service is used, not before it is listed.

## Prohibited outright

Workers Paid · **Workers for Platforms (paid-only)** · Cloudflare for SaaS paid features ·
R2 Infrequent Access · paid Workers AI · any add-on, overage, or automatic upgrade ·
GitHub Team/Enterprise · larger runners · paid Actions overage · paid Packages · paid
Codespaces · GitHub Advanced Security paid features · paid Copilot charged to the project ·
marketplace purchases without user approval.

## The rule that matters most

**Exceeding a free allowance must stop or degrade non-essential service. It must never
silently create a charge.** A design that can only work by exceeding a free limit is not a
design — it is an unapproved purchase.
