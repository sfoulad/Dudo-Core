# 0042 — Two count routes, each borrowing the permission of the list it counts

- **Status:** **RULED AND AUTHORED 2026-09-11. NOT YET IMPLEMENTED, NOT CONSUMED.** Team Lead ruling
  on `architecture-agent`'s proposal; both contract amendments landed the same day. **Core has not
  implemented either route and no client calls one** — see *Sequencing* for why the hold was lifted
  on half its trigger.

  **The status moved after the Team Lead READ both amendments, not after reading the report about
  them.** `security.md` §8a governs the inverse case — an agent may not record another party's
  decision — and the same reasoning binds this direction: this field is a record that a specific
  reader checked specific text, so a report that the work is ready is evidence the reading is owed,
  never a substitute for it. **What was checked, against this file rather than against a summary:**
  each count sits beside the list it counts, under that list's existing permission
  (`core.organization.list` · `core.template.list`), takes no filter and no parameters, returns a
  scalar `total`, carries `audit: required`, and resolves no store handle. **The family note is on
  `platform.templates.count` itself** — `whyITNEEDSNOPERMISSIONOFITSOWN_ANDTHEADOPTIONCOUNTDID` —
  rather than in a summary, which is what this decision required and the thing a report cannot
  demonstrate.

  **One thing the amendments got right that this decision never said:** `platform.templates.count`
  explicitly refuses `templateStatusFilter` and states why on the route. **A total that accepts a
  filter is a query**, and the shape constraint here was written against breakdowns and groupings —
  a filter is the same disclosure arriving one parameter at a time. **The author closed a door this
  file left open**, and it is recorded here so the next reader does not read the silence as
  permission.
- **Owning agent:** `architecture-agent` authors both amendments; `core-agent` implements;
  `web-agent` consumes.
- **Governs:** `platform.organizations.count`, `platform.templates.count`, and any future aggregate
  over a platform population.
- **Arises from:** the Platform dashboard having no way to state a total, because neither list route
  publishes one.

---

## The problem, and the answer that was NOT taken

`platform.organizations.list` and `platform.templates.list` both return `{ data, next_cursor }` and
**neither carries a total.** So an operational summary can honestly say *"at least 25"* and nothing
more.

**`web-agent` did not approximate one, and the reason is the cost:** reading every page to count
spends **an audited call per page** to compute a number that changes between the first page and the
last. On `platform.organizations.list` that is an audit row per page, per dashboard open.

## The decision

**Two routes, not one. Each sits beside the list it counts, in that list's own contract, gated by
that list's existing permission.**

| Route | Contract | Permission | Rung |
|---|---|---|---|
| `platform.organizations.count` | `platform-operator-v1` | `core.organization.list` | sensitive |
| `platform.templates.count` | `template-v1` | `core.template.list` | read |

**No new permission.** Both are **additive amendments to accepted contracts**, which
`architecture.md` §1 permits without a further record; this file exists for the *reasoning*, which is
the part that would otherwise be re-litigated.

**Shape: a scalar `total` and nothing else.** No per-population breakdown, no grouping, no
`by_status` map. **Each of those transposes into a mapping, and the mapping is the object `0028`
Decision 1 refuses.** Control-plane only; nothing behind `whereWithTenant`.

## Why no new permission — the enumeration test

**The full rule is `security.md` §2a and it is not restated here.** In one line:

> **A count is safe exactly when its consumer already holds enumeration over the counted population,
> and dangerous exactly when it does not.**

**A holder of `core.organization.list` already enumerates every Organization, deliberately, at
`sensitive`. A count reaches nothing past that right.** Same for Templates and `core.template.list`.

**And this is the merits answer to `platform-operator-v1`'s `theLine.out`, not a scope
distinction.** That block refuses counts of business records because *"how many customers is how a
console acquires cross-tenant reach one convenient number at a time."* **The operative fact is that
a platform operator holds NO enumeration right over customers** — so each such count is genuinely
new and they compose into a picture of a tenant's business. **The rule turns on the right, not on
the object.** Distinguishing this on *"control-plane versus business records"* would have been the
scope move this repository has twice ruled against.

## WHY ONE COMBINED ROUTE IS NOT AVAILABLE, and it is mechanical rather than aesthetic

`PlatformRoutePermission` is `{kind:'fixed'} | {kind:'from-body'}` — **exactly one permission per
route.** A combined `platform.counts` would therefore need a **single permission gating a disclosure
over two populations.**

> **That is the family-grant problem that made `core.template-adoption.read` a separate name in the
> first place**: a permission filed where a grantor already decided about the family arrives with
> that family, silently.

**Two calls and two audit rows is the honest cost.** Recorded because a combined route is the
obvious simplification and will be re-proposed by someone who has not met this paragraph.

## The argument that made this a clear yes rather than a grudging one

**The cheaper route is the MORE detectable one, which inverts the usual instinct to refuse an
aggregate.**

**Counting by enumeration is indistinguishable from ordinary browsing** — page reads that look
exactly like an operator working. **A dedicated count call is unambiguous about intent**, so 365
identical count entries in the platform audit trail are a far clearer signal than 365 bursts of
paginated reads.

**Refusing the route would keep the capability, remove the audit clarity, and charge an audit row
per page for the privilege.**

## ⚠ FREE-TIER IMPACT — OWED BY `architecture.md` §6a AND ABSENT UNTIL 2026-09-11

**This section was missing when the decision was ruled, and its absence is the finding.** `§6a`
requires a free-tier impact check for **every new service or feature** — which allowance it consumes,
expected usage, and what happens at the limit. **This ADR argued the enumeration test, the family
risk, the shape constraint and the audit-detection trade, and never asked what the routes cost.**

**Raised by `security-agent` (SR-15) in a review commissioned for something else entirely** — which is
the second time in this milestone that the axis nobody named was the one that mattered.

| | |
|---|---|
| **Allowance** | **D1 rows READ per day — 5,000,000.** Not writes: each call charges the ordinary `PLATFORM_OPERATOR_ACTION_ROW_WRITES` of 4 for its audit record, which is already bounded four ways |
| **Expected usage** | `platform.templates.count` is a bounded `COUNT(*)` over `template`, a small control-plane table. **`platform.organizations.count` is `SELECT COUNT(*) FROM organization` — a full scan whose cost is the customer count** |
| **At the limit** | **`Queries FAIL account-wide — not billed`.** Every D1 query, every tenant, including session creation. The symptom is *"nobody can log in"*; the cause is a dashboard |

```
PER_PRINCIPAL_DAILY_ROW_WRITES 600 / PLATFORM_OPERATOR_ACTION_ROW_WRITES 4 = 150 calls/operator/day
150 × operators × N_organizations >= 5,000,000
    1 operator ->  N ~= 33,300      3 -> ~= 11,100      6 -> ~= 5,600
```

**THE WRITE CEILING IS WHAT CURRENTLY BOUNDS THE READ COST, AND THAT IS AN ACCIDENT RATHER THAN A
DESIGN.** These routes are bounded only because every platform call writes an audit row and audit
writes are metered. **A future read-only platform route that skipped the audit record would have no
ceiling at all** — and `audit: required` on both counts is therefore doing load-bearing work this
decision credited only to detection.

**Does this change the decision? No, and the reason is the one this ADR already gave from the other
side.** Counting by pagination reads *more* rows than a `COUNT(*)`, not fewer — so refusing these
routes would raise the read cost while removing the audit clarity. **The routes are the cheaper
option on this axis too. What was wrong was not measuring it.**

**Owed, and named rather than left implicit:** an index on `organization(template_id)` is the
mechanical fix for the related `platform.templates.usage` scan. **It is a migration and therefore the
user's, every time.** Recorded in `docs/operations/free-tier-register.md` with the route that wants
it.

## Rate limiting is not the control, and a later proposal to substitute it answers a different attack

**The vector is longitudinal, not burst.** One call a day for a year is rate-limited by nothing and
yields a growth curve; a limit bounding requests per minute bounds a scrape and does not bound
sampling over months.

**The permission is the control. The audit trail is the detection.** A rate limit added *alongside*
is fine; one proposed *instead* is answering a question nobody asked.

## Sequencing — ruled, then deliberately held

**Ruled 2026-09-11 and immediately queued.** At the time of ruling, Core had the four Template
permissions in `platform-admin`'s frozen list and **no route declaring any of them** — the ids were
in the route-id type union and the entries were unwritten, with two suite assertions correctly red
on that state.

> **Adding two more routes to a half-built surface widens the half-built thing.** The dashboard ships
> honestly without counts, and **a bound that is true beats a number that is computed.**

**The trigger is an event, not a date:** Core's five Template operations registered and the gate
green. `architecture-agent` holds until the Team Lead calls it.

### RELEASED 2026-09-11 ON HALF THE TRIGGER, DELIBERATELY, AND THE HALF THAT WAS MISSING IS NAMED

**The five operations are registered and verified reachable end to end. The gate is NOT green** —
eleven suite failures at the moment of release. **The release is correct anyway, and the reason is
what those eleven are:** every one is `packages/testing/**` — five missing entries in a fixture's
path-parameter map, an envelope pin moving 9 → 13, and two route allow-lists short by the same five.
**Not one is a Core operation failing.** The condition this hold protected against — *adding two more
routes to a half-built surface widens the half-built thing* — had stopped applying.

**Recorded rather than rounded, because a trigger quietly declared satisfied is worse than one
consciously overridden.** A future reader finding *"released when the gate went green"* would be
reading a sentence nobody could have checked.

**And "verified reachable" is load-bearing here rather than decorative.** All five routes appeared to
fail for a platform-admin with `internal`, and **the Team Lead attributed that to a gap in Core's
composition and briefed `core-agent` accordingly. It was false.** `core-agent` drove the real
handlers against real adapters and real migrations, got all five succeeding, and settled it with a
control the diagnosis could not survive: **`platform.templates.read` — shipped weeks earlier, none of
the new code — fails identically when its path parameter is withheld.** The `internal`s were a test
fixture with no entry for the new routes.

> **The surface this decision extends is verified working rather than assumed working, and it spent
> an hour looking broken on a cause that was invented.** Two accurate observations — *registered* and
> *erroring* — joined by a `because` nobody had earned. `workflow.md` §11a's test is *which of the
> two things I measured could be the wrong one*, and the answer was **either**.

## One note that must go ON the route, not in a summary

**`platform.templates.count` sits inside `core.template.*` — the same family whose grant-by-family
risk made `core.template-adoption.read` a separate name.** The distinction must be stated on the
route itself:

> **`core.template.list` holders already enumerate Templates, so a Template count reaches nothing
> past their enumeration right. The ADOPTION count crosses into the ORGANIZATION population, which
> `core.template.list` grants nothing over.** Same family, different populations, and that is the
> whole difference.

**A reader meeting a count in that family should get the distinction on the spot rather than
re-deriving it from two contracts.**
