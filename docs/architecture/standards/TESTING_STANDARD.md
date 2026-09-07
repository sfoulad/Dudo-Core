# Testing Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **No *third-party* test framework is approved, and a first-party suite exists and runs anyway** — `npm test` → `tools/run-suites.mjs` → four entry points under `packages/testing/`. See TS1, reclassified 2026-09-06. This standard is framework-neutral by construction, and that turned out to be the property that mattered.
- **Authored by:** `architecture-agent`. **Tests are authored by `qa-agent`.**
- **Applies to:** `packages/testing/**`, `apps/*/tests/**`, `connectors/*/tests/**`, and Apple test targets.
- **Depends on:** every other standard — the checklists in each are what tests verify.

---

## 1. Who tests

**The test agent works independently from implementation**, and **the agent that writes the
implementation is never the final approving agent** (`CONSTITUTION.md` §4.1).

- `qa-agent` authors and runs everything under test paths.
- `qa-agent` never edits production feature code. Defects route to the owning agent
  through the Team Lead.
- `qa-agent` **never weakens a test, deletes an assertion, adds a skip, or loosens a
  matcher to produce a pass.** A failing test is information; a test edited to pass is
  disinformation.
- Reporting is exact: **passed · failed · skipped · not run**, as actually observed. Green
  is never assumed, inferred, or rounded up from a partial run.

---

## 2. Test types

Every App, Capability, Connector, and Core module has all seven where applicable.

| Type | Verifies | Notes |
|---|---|---|
| **Unit** | Internal logic in isolation | `domain/` must be testable with no network, no database, no Cloudflare. If it is not, the boundary is wrong. |
| **Contract** | Producer and consumer against the published contract | Both sides. §3. |
| **Event** | Published and consumed events | Envelope, versioning, idempotency, out-of-order. §4. |
| **Authorization** | Permissions and scopes | Matrix, not spot checks. §6. |
| **Tenant isolation** | Tenant A never reaches tenant B | Mandatory for every tenant-data feature. Under `0006` (Option A, one shared database) this means five things, not one: canonical test, per-query-path coverage, `TenantStoreResolver` test, storage-boundary bypass test, negative control. §5. |
| **Integration** | Cross-App behaviour through APIs and events | Real boundaries, not mocks of our own code. |
| **E2E** | Critical user journeys | Both clients, from Phase 4. |

---

## 3. Contract tests

A contract test binds **both** sides. Testing only the producer proves the producer is
self-consistent, which is not the failure mode anyone has.

- The producer satisfies the published request and response shapes, every declared error
  case, the declared authorization expectation, and the declared tenant scope.
- Every consumer — Core, App, `platform/web`, **and `Dudo-Apple`** — is verified against
  the same published contract. Divergence between the two clients is a contract defect,
  not a client workaround.
- A contract change runs the consumers' tests before it merges. A breaking change that
  nobody noticed is a breaking change that shipped.
- Contract tests assert the *contract*, not the implementation. A test that would fail on
  a valid refactor is testing the wrong thing.

---

## 4. Event tests

For every published event:

- Envelope complete; `tenant_id` never null; `correlation_id` propagated.
- Payload matches the registered schema in `event-catalog.yaml`.
- Published **after** the state change commits, never before.
- Registered in the catalog — a test asserts that every published type appears there.

For every consumer:

- **Idempotent:** delivering the same event twice produces the same end state. Demonstrated,
  not asserted in a comment.
- **Out-of-order tolerant:** a later event arriving first does not corrupt state.
- Failure retries with bounded backoff; exhaustion dead-letters rather than looping.
- The consumer stays inside the event's tenant.

---

## 5. Tenant-isolation tests

**Mandatory for every feature that touches tenant data.** No exceptions, no deferrals.

### 5.1 What these tests are carrying, under the decided model

`0006` is **Accepted**: **Option A — one shared production D1 database** (`MULTITENANCY_STANDARD.md`
§7.1). State the consequence for testing plainly, because everything in this section follows from it:

> **STALE PREMISE, corrected 2026-09-06 (`workflow.md` §12).** This paragraph read *"for the
> Zero-Cost MVP while `0008` is active."* **`0030` withdrew the MVP framing**; `0008` (zero cost) is
> untouched and `0006` is **not** reversed. What changed is the reason this section is binding:
> Option A is no longer a temporary concession to be tested loosely until a better model arrives,
> it is the model, and `0030` requires the *choice* to stay reversible. **Nothing below weakens;
> §5.5's structural bypass test is now also the test that keeps the tenancy model replaceable.**

> **There is no physical boundary between two Organizations' data.** Every row of every
> tenant sits in one database, and the only thing keeping tenant A out of tenant B's
> records is a `tenant_id` predicate on every single query, applied **centrally by the
> Core-owned storage boundary**. **One missing predicate is a breach of the entire customer
> base**, not of two tenants.

Two things follow, and both change how this section must be read.

**These tests are now worth more, not less.** Under a database-per-tenant model an
unexercised path was still structurally isolated, so an isolation test largely confirmed
something the architecture already guaranteed. Under Option A the test exercises the
**actual** failure mode of the architecture. A pass is meaningful.

**And the standard for what counts as a pass is higher.** Under Option A an unexercised
path is not a gap in coverage — it is an **unprotected path**. The value of a green result
is realised only if coverage is complete, and completeness has to be demonstrated rather
than assumed.

`MULTITENANCY_STANDARD.md` §7.6 and §8 state the same obligations from the tenancy side.
They are restated here in this document's own words, deliberately, so that a gate report
cannot overstate what *"tenant-isolation tests pass"* means. §5.2–§5.7 are all **required**
for any feature touching tenant data; none is optional and none is deferrable to a later
phase.

### 5.2 The canonical test

> Create tenant A and tenant B with equivalent data. Acting as a **fully privileged**
> principal in tenant A — an owner holding every permission — attempt to **read, list,
> update, delete, export, enumerate, and infer** tenant B's records through every surface
> the feature exposes: public API, internal API, event consumption, workflow, file access,
> search, and MCP.
>
> Every attempt returns `not_found` or an empty result. No response body, error message,
> status code difference, or log line reveals that tenant B's data exists.
>
> **For equivalent unauthorised requests, status, error shape, response-size class and
> timing distribution must not reveal whether another tenant or its resource exists.**

Also asserted:

- Cross-tenant access returns `not_found`, **never `forbidden`** (`API_STANDARD.md` §8).
- Cache keys, object keys, queue messages, and scheduled jobs carry the tenant.
- No log line or error message contains a foreign tenant identifier or business data.
- **Fixtures and seeds contain no cross-tenant reference.** Cross-tenant access in a
  fixture is a critical defect exactly as in production code.

The privileged principal matters: an under-permissioned principal fails for the wrong
reason and proves nothing about isolation.

**Aggregates, counts, and facets are in scope of "infer".** A `COUNT`, `SUM`, `AVG`, `MAX`,
report total, chart series, pagination total, search facet, autocomplete suggestion, rate
limit, quota reading, or "N results" badge that includes tenant B's rows is a cross-tenant
leak, even when no record of tenant B is returned. `MULTITENANCY_STANDARD.md` §7.7 notes
that under Option A a cross-tenant aggregate is *"trivial — one `GROUP BY`"*, which is
precisely why it is the cheapest leak to write by accident. **Every aggregate a feature
exposes is asserted to change when tenant B's data changes only if the aggregate is tenant
B's own.** An aggregate that is not asserted is not covered.

**On the timing clause — what it does and does not mean.** The sentence above is a
requirement, not an aspiration, and the following is how it is read:

- **Ordinary load variation on a shared D1 is not automatically a failure.** Under Option A
  the database is shared and `MULTITENANCY_STANDARD.md` §7.7 accepts that *"one
  Organization's heavy query is every Organization's latency"*. Latency that moves with
  overall load, cold starts, queue depth, or an unrelated Organization's heavy query is
  noise, and noise is not a finding.
- **A statistically distinguishable difference that correlates with the existence of
  another tenant or its resource is a failure.** The failure mode is signal, not variance:
  if the distribution for "the resource exists in tenant B" separates from the distribution
  for "the resource does not exist anywhere" for equivalent unauthorised requests, the
  system is disclosing existence and that is a tenant-isolation defect.
- **TS5 owns the method.** Sampling size, tolerance, statistical test, and the verification
  procedure are defined by the resolution of TS5 (§11). This section states the obligation;
  TS5 states how it is measured. Neither substitutes for the other.
- **Until TS5 is resolved and implemented, this control is reported as `UNVERIFIED / NOT
  RUN`.** That is its honest status, and it is stated in the gate report as such — per
  §5.7 and the reporting standard, an unmeasured control is reported as unmeasured.
- **It is never reported as passed without measurement.** No inspection, no argument from
  design, no "we scope every query anyway" reasoning may tick it. Only a recorded
  measurement, run by the method TS5 defines, can move it off `UNVERIFIED / NOT RUN`.

**Scope — the premise that made this cheap has expired.** This is a runtime control over a
running system holding tenant data.

> **CORRECTED 2026-09-06. The sentence here read: *"Phase 0 has neither a runtime nor tenant
> data, so `UNVERIFIED / NOT RUN` here does not block the Phase 0 foundation."* **Both halves
> of that premise are now false.** A runtime exists — two Workers deployed, `dudo-core` and
> `dudo-admin` (`docs/product/superadmin-test-checklist.md:23–24`) — and tenant data exists:
> **three Organizations, seeded** (line 26).
>
> **The conclusion still holds, but for a different and narrower reason**, and the difference
> is the whole point of re-deriving rather than leaving it propped up. It no longer holds
> because *"there is nothing to measure"*. It holds because **the data is synthetic and
> operator-seeded, and the deployment is staging rather than production**. That reason expires
> the first time a real customer's records are in the shared database — which is a date
> somebody chooses, not a phase that arrives.
>
> **So the blocking condition is unchanged and is now the operative half of this paragraph, not
> the hypothetical half:** `UNVERIFIED / NOT RUN` **is a mandatory blocker before any production
> release serving real tenant data.** The verification is owed, the debt is recorded here rather
> than written off, and **the runway for paying it is shorter than this paragraph used to
> imply.**
>
> **A second, live consequence, because it is the same control seen from the deployed side.**
> `docs/operations/deployment-runbook.md` §8b records that `verify-staging.ts` CHECK 4b — the
> **two-tenant isolation probe against the deployed system** — *"always reports NOT RUN"* with
> one seeded Organization, and that until a second exists *"the deployed isolation evidence is
> weaker than the harness evidence."* **Three Organizations are now seeded, so that check is
> runnable for the first time**, and this standard has no record of it having been run with
> `--other-org`. That is a `not run` which is now avoidable, and §5.7 requires it to be reported
> as `not run` rather than covered by the harness result.

### 5.3 Coverage is per query path, not per endpoint

**A tenant-isolation suite is measured in query paths, not endpoints, actions, or
features.** A query path is any distinct route by which the feature's code causes a read or
write to reach tenant data — including list and detail reads, writes, deletes, exports,
search and index reads, event-consumer reads, workflow-step reads, scheduled-job reads,
cache population and cache reads, and every aggregate in §5.2. One endpoint routinely
contains several; one query path may be reachable from several endpoints.

- **Sampling is false assurance, and false assurance is worse than none.** A green result on
  a sampled endpoint proves nothing about the path that was not sampled, and under Option A
  the unsampled path is not weakly protected — it is unprotected.
- **The set of query paths is enumerated, not estimated.** The isolation suite for a feature
  records the enumeration it tested against and how the enumeration was derived — from the
  storage-boundary call sites, not from the endpoint list.
- **Completeness is evidenced in the report, not asserted.** A gate report states the number
  of query paths enumerated, the number exercised, and **every path not exercised, by
  name, with the reason.** "Isolation tests pass" with no denominator is not a result.
- A new query path added later is a new isolation obligation. It does not inherit the
  coverage of the endpoint it was added to.

### 5.4 The `TenantStoreResolver` test — mandatory

The Core-owned `TenantStoreResolver` (`MULTITENANCY_STANDARD.md` §7.2, binding by user
decision in `0006` §0.2) is itself an isolation boundary, and it is the one every query path
depends on. It carries its own dedicated suite, independent of any feature:

- **Unknown Organization fails closed.** An unknown, unmapped, deleted, suspended, or
  malformed Organization identifier resolves to **no** store. It must not fall back to a
  default binding, the first binding, the last-used binding, an ambient binding, or an empty
  but writable one. Asserted for each of those cases separately, because "fails closed" is a
  claim about the default branch and the default branch is where it will be got wrong.
- **No caller can select a binding.** No App, plugin, Connector, client, request field,
  header, token claim, query parameter, event payload, workflow input, or test helper can
  choose, name, override, or influence which store is resolved. Tenant identity comes from
  the authenticated server-side context only (`MULTITENANCY_STANDARD.md` §3). Asserted as a
  negative: an attempt to supply one is rejected, and does not silently win, and does not
  silently lose while a caller-supplied value is used elsewhere.
- **Only Core-configured bindings are returned.** The resolver returns bindings from Core
  configuration and nothing else — never a binding constructed from input, never one read
  from tenant-controlled data.
- **No cross-tenant handle leak.** A principal in tenant A cannot resolve, be handed, or
  **cache** another Organization's binding. Resolution is asserted to be per-request and not
  memoized across tenants, principals, or requests in a way that outlives its scope.
- **The resolver is exercised, not stubbed, by feature isolation suites.** An isolation suite
  that replaces the resolver with a test double proves the feature, not the model. Where a
  double is unavoidable it is recorded as an explicit gap in the gate report.

### 5.5 The storage-boundary bypass test — mandatory, and structural

**The control the model actually relies on is the central application of the `tenant_id`
predicate. That control is required by `MULTITENANCY_STANDARD.md` §7.6 and must be tested
directly** — not inferred from feature tests passing. This test is structural: it asserts a
property of **all** query paths rather than of the paths someone remembered to exercise,
which is the only form of coverage that scales under Option A.

Required assertions:

- **No query path reaches D1 outside the Core-owned storage port.** No module outside the
  port constructs, holds, imports, receives, or issues a D1 query, statement, batch, or
  handle. No domain module, App, Capability, Connector, or SDK surface can obtain a raw
  binding from `env` or from any other ambient source.
- **The port cannot emit a tenant-scoped read or write without a tenant predicate.** A
  tenant-scoped query constructed without a tenant predicate fails at the boundary — loudly,
  at construction or execution — rather than running unscoped.
- **Every deliberate exception is enumerated and justified.** Genuinely tenant-independent
  storage (platform configuration, migration bookkeeping) is listed by name in the test
  itself, so the list is reviewable and additions to it are visible in a diff. An unlisted
  unscoped query is a **critical defect**, exactly as in production code.

This is the analogue, for the domain → D1 boundary, of `SDK_STANDARD.md` VAL-SDK-8 for the
App → API boundary. Both exist because a boundary that is only documented is not a boundary.

### 5.6 Negative control — a suite that cannot fail is not evidence

**A passing isolation test tells you nothing unless you know it would fail if isolation
were broken.** This matters more under Option A than it would under any other model: a suite
that happens to query through a layer which silently scopes everything will pass whether or
not the feature under test is correct. Without a sensitivity check, a green isolation
result is ceremony.

For every isolation suite, the following is **required before the suite may be cited as
evidence in a gate report**:

- **A recorded negative-control run.** The predicate is deliberately removed, the resolver
  deliberately made to return tenant B's store, or the query path deliberately routed around
  the storage boundary — and the suite is shown to **go red**, naming which assertions
  failed.
- **A suite that stays green under a deliberately broken predicate is a defective suite**,
  reported as a defect against the suite, and its previous green results are withdrawn —
  they were never evidence.
- The negative control covers **each** of the three controls separately — predicate,
  resolver, boundary — because a suite can be sensitive to one and blind to the others.
- The break is **never** committed. It is a recorded run, with its output, in the gate
  report. A permanently broken-by-configuration path does not exist in the repository.
- Where the toolchain supports mutation testing, mutating the tenant predicate is the
  preferred mechanical form of this requirement; where it does not, a manually recorded run
  satisfies it. The requirement is the evidence, not the tool.

> **BUILT — the sentence that stood here was wrong about the future.** It read *"TS1 is unresolved,
> so the mechanism is chosen when the framework is chosen."* **The mechanism was built without a
> framework decision, and all three controls this section names exist and run.**
> `packages/testing/run-customer-directory.ts:13` — *"A primary run, then THREE NEGATIVE-CONTROL
> RUNS — predicate, resolver and boundary"* — with the substituted stores in
> `packages/testing/harness/broken-controls.ts` (`createPredicateBrokenStore:87`,
> `createBoundaryBypassStore:155`, `createAdmissionBypassStore:269`) and the resolver control at
> `run-customer-directory.ts:129` (`resolverMode: 'always-organization-b'`). The break is
> substituted at composition and never committed, as this section requires.
> **The reporting half is in the runner, not in the suite:** `packages/testing/harness/runner.ts`
> labels isolation assertions (`ISOLATION`, line 54) so a control run distinguishes *red on an
> isolation assertion* from *red on something else* from **green — the case does not test isolation,
> whatever its name says.** That third outcome is the one §5.6 exists to detect and it is
> machine-detected rather than argued.

### 5.7 What a gate report may and may not claim

The `- [ ] Tenant-isolation tests pass` item in §8 is **not tickable** from a passing
canonical test alone. It is tickable only when all of the following are reported, with
actual results:

| Required for the tick | Reported as |
|---|---|
| §5.2 canonical test, including aggregates | passed · failed · skipped · not run |
| §5.3 per-query-path coverage | paths enumerated, paths exercised, **paths not exercised by name** |
| §5.4 `TenantStoreResolver` suite | passed · failed · skipped · not run |
| §5.5 storage-boundary bypass test | passed · failed · skipped · not run, plus the enumerated exception list |
| §5.6 negative control | the recorded red run for each of the three controls |
| §5.2 non-disclosure of existence — status, error shape, response-size class, timing distribution | passed · failed · **`UNVERIFIED / NOT RUN`** — and `UNVERIFIED / NOT RUN` until TS5 is resolved and implemented |

Anything missing is reported as **missing**, not rounded up. "Tenant-isolation tests pass"
asserted without a denominator, without the resolver and bypass suites, and without a
sensitivity result is the overstatement this section exists to prevent.

**On timing.** §5.2 requires that *"for equivalent unauthorised requests, status, error
shape, response-size class and timing distribution must not reveal whether another tenant
or its resource exists."* It is a requirement of record. What is missing is not the
obligation but the **method**: under a single shared, single-threaded D1 where
`MULTITENANCY_STANDARD.md` §7.7 accepts that *"one Organization's heavy query is every
Organization's latency"*, timing is noisy, and no sampling size, tolerance, or statistical
test is specified anywhere yet. TS5 (§11) owns specifying it.

The risk that motivated the earlier attempt to drop this clause is real — **a requirement
nobody knows how to verify gets ticked rather than met** — and it is answered by reporting,
not by deletion. Until TS5 is resolved and implemented, the control is reported as
**`UNVERIFIED / NOT RUN`**, never as passed, and never silently omitted from the report. An
unverified requirement is a debt that is visible; a deleted requirement is a debt nobody
owes. The deterministic channels — response body, status code, error code, headers, log
lines, result counts, and the aggregates in §5.2 — remain independently hard requirements
and are verified today.

`MULTITENANCY_STANDARD.md` §8 carries the same canonical sentence verbatim; the two
documents are aligned and must be changed together.

---

## 6. Authorization tests

A matrix, per Action:

| Case | Expected |
|---|---|
| Unauthenticated | `unauthenticated` |
| Authenticated, no permission | `forbidden` |
| Correct permission, scope too narrow | `forbidden` |
| Correct permission, correct scope | success |
| Correct permission, resource in another tenant | `not_found` |
| App calling without a declared permission | denied at the boundary |
| App calling with a granted permission | success |
| Permission revoked, next call | denied — not on the next deploy, not on the next session |
| AI principal exceeding the acting user's permission | denied |
| `sensitive` action | audit record written |
| `critical` action without confirmation | denied |

Also: no role name drives behaviour (change the role's name, behaviour is unchanged); a
wildcard in an App manifest fails validation.

---

## 7. Test data

- **Synthetic only.** Never real customer data, in tests, fixtures, seeds, or
  documentation.
- No real credentials, tokens, or keys — not even expired ones, and not even "obviously
  fake" ones that pattern-match a real format and will be flagged forever by every scanner.
- Fixtures are tenant-scoped and named for what they demonstrate.
- Tests are deterministic. Fixed clocks, fixed identifiers, no reliance on wall-clock
  timing or ordering. A flaky test is worse than no test: it trains the team to ignore red.

---

## 8. Definition of done

This list is the definition of record. A task is complete only when **all** hold, verified
and reported honestly:

- [ ] Code compiles.
- [ ] Type checking passes.
- [ ] Unit tests pass.
- [ ] Contract tests pass — producer and every consumer.
- [ ] Integration tests pass.
- [ ] **Tenant-isolation tests pass** — all five parts of §5, reported per §5.7: canonical
      test including aggregates; per-query-path coverage with paths enumerated, exercised,
      and **not** exercised named; `TenantStoreResolver` suite; storage-boundary bypass
      test; and the recorded negative-control red run. **Not tickable from a passing
      canonical test alone, and not tickable from a sampled endpoint.**
- [ ] **Non-disclosure of existence** — status, error shape, response-size class and timing
      distribution, per §5.2. Reported as `UNVERIFIED / NOT RUN` until TS5 defines and the
      team implements the measurement method. **Never ticked without measurement.**
      ~~Does not block Phase 0;~~ **corrected 2026-09-06 — a runtime and three seeded
      Organizations now exist, so the "nothing to measure" premise is gone (§5.2).** It does not
      block *today* only because the data is synthetic and the deployment is staging, and it
      **blocks any production release serving real tenant data.**
- [ ] **Permission tests pass.**
- [ ] Security review passes (`SECURITY_STANDARD.md` §12), by an agent that did not write
      the code.
- [ ] API specification updated.
- [ ] Events documented and registered.
- [ ] MCP definition updated where relevant.
- [ ] Audit events implemented.
- [ ] Logging added, with the five correlation fields and no business data.
- [ ] No direct cross-App database access.
- [ ] No secrets in source.
- [ ] Migration is safe — forward-only, tested against representative data.
- [ ] Rollback path exists and has been described.
- [ ] Documentation updated.

**Partial completion is reported as partial**, itemised. Honest failure is a valid,
valuable report; overstating completion is not.

---

## 9. Where tests live

Fixed by `0004`:

- `apps/<app>/tests/` — per-App suites, colocated.
- `connectors/<connector>/tests/` — including the capability conformance suite.
- `packages/testing/` — cross-cutting suites, contract tests spanning modules, and the
  shared harness.
- `Dudo-Apple` test targets — client-side contract and E2E.

`qa-agent` owns all of them. **Root-level shared test configuration belongs to the Team
Lead** (`0001`); `qa-agent` proposes changes to it and does not edit the root.

> **CONTRADICTED, 2026-09-06 — the first App's suites are not colocated, and this standard should
> not be quietly rewritten to match.** `0004` and this section both say `apps/<app>/tests/`.
> **`apps/customers/` has no `tests/` directory.** The Customer Directory suites live in
> `packages/testing/suites/customer-directory/` (eleven files), reached through
> `packages/testing/run-customer-directory.ts`, and the App-manifest fixtures live in
> `packages/testing/fixtures/app-manifest/`.
>
> **Which side is wrong is a Team Lead call, and there is a real argument each way.** Colocation is
> what makes an App a self-contained installable unit — the property `APP_STANDARD.md` §1 calls
> ownership that "leaks" when it is partial, and the property a third-party App author will need.
> Against that: these suites compose **Core's** pipeline, storage boundary, resolver and negative
> controls, so under the current in-process App runtime they are not App-local tests at all — which
> is a fact about the missing SDK (`SDK_STANDARD.md` SD7), not about where files belong.
> **The forecast, stated so it can be checked: if the App runtime lands and this is still
> unresolved, the second App will copy the first**, and colocation will then cost a migration
> rather than a decision.

---

## 10. CI

Every merge runs, in order: format · lint · type check · unit test · contract test ·
security checks · build · integration test · deploy staging · smoke test.

- **A check that has never run is not a passing check.** Nothing becomes a required check
  until it has passed for real at least once (`0005` step 6).
- Migrations run through controlled deployment workflows, never ad hoc.
- Production deployment happens only after all gates pass **and** the user approves.

---

## 11. Open questions

**Reconciled against the built system, 2026-09-06.** Every row carries a **State**: `CLOSED`
(something built or decided answers it, with a citation), `OPEN` (a named decision is still owed),
or `CONTRADICTED` (the implementation went a different way than this standard said it would — those
are reported, never resolved by editing the standard to agree).

| # | State | Question | Recommendation |
|---|---|---|---|
| TS1 | **CONTRADICTED**, then narrowed | **What this row asserted is false as written.** It said an ADR was needed *"before any test is written"* and that this *"blocks Phase 1 verification."* **Phase 1 was verified. Four suite entry points run from `npm test`, with no third-party framework and no ADR** — the Team Lead's last recorded measurement was 564 cases, 0 failed, which is a figure from a run rather than from this file, and no count is recorded anywhere in the repository. The gate is `package.json:16` → `tools/run-suites.mjs`, whose `SUITES` array names `run-platform-operator.ts`, `run-customer-directory.ts`, `run-az2-login.ts` and `run-type-negative.ts`; it reports each suite's actual state, runs all four even when one fails, and exits non-zero. The runner is `packages/testing/harness/runner.ts` — ~150 dependency-free lines whose own header says *"when TS1 is decided, the suites move and this file is deleted."* **The framework-neutrality this standard was written for is what made that possible**, and the blocking claim was the part that was wrong. | **The residual question is real and much smaller: adopt a third-party framework, or ratify the first-party runner as the answer.** `0016` (Accepted) records it as open — *"Choosing Vite did not choose Vitest, and `qa-agent`'s dependency-free runner stays until TS1 is decided on its own merits"* — and `docs/decisions/README.md` line 113 says the same. **It blocks nothing.** Two facts the eventual ADR must weigh, neither of which existed when this row was written: **(1)** the original recommendation — execute against the real Workers runtime rather than a Node emulation — is **still unmet**, because the suites run on Node against a SQLite double (`packages/testing/harness/sqlite-d1.ts`), so "testing Workers code in Node proves the wrong thing" remains a live criticism of what exists, not an argument for a package; **(2)** replacing the runner costs the three things it was built for and a generic one does not do — whole-error comparison in `expectError`, `ISOLATION:`-labelled assertions, and `not_run` as a distinct state. **Do not adopt a framework that cannot express those three.** Team Lead records; `qa-agent` evaluates. |
| TS2 | **CLOSED** | ~~**Test data for the tenancy model**~~ — **built, in exactly the shape this row specified.** Two active Organizations plus one unmapped one at `packages/testing/harness/world.ts:117` (`ORG_UNMAPPED`); the directory fixture at `packages/testing/harness/control-plane-fixture.ts:10` — *"that an unknown Organization fails closed through `tenant_directory` (`0006` §0.2)"*; and §5.4's fail-closed cases at `packages/testing/suites/az2-login/tenant-resolution.ts:169–260`, which assert **unknown, empty-directory, suspended, migrating, unrecognised-binding and unreadable-directory** each separately, as §5.4 requires of a default branch. No database is created and no remote slot is consumed — the harness runs against `packages/testing/harness/sqlite-d1.ts`. **The dependency this row declared was wrong and is kept visible:** it said *"the harness cannot be written until a test framework is approved."* It was written without one. The only gap that survives is not TS2's — the harness is a SQLite double rather than the Workers runtime (TS1). | ~~The two-tenant harness is now specifiable: **one database, two `tenant_id` values**, no per-tenant provisioning step, no database creation, and **no remote slot consumed** — local and CI runs use `wrangler dev`'s local mode and never set `"remote": true` (`CLOUDFLARE_STANDARD.md` §4.1). The harness must also provision the `TenantStoreResolver` mapping for both tenants plus one **unmapped** Organization, because §5.4's fail-closed case cannot be tested without one. **What TS2 now depends on instead: TS1 only** — the harness cannot be written until a test framework is approved. It is no longer blocked on the architecture, only on the toolchain.~~ Struck 2026-09-06: written, without one. |
| TS3 | **OPEN** — root: contract transport (`API_STANDARD.md` AS1) | **Cross-repository contract testing.** `Dudo-Apple` is a separate repository, so verifying it against `Dudo-Core`'s contracts needs a distribution mechanism. **Now evidenced rather than predicted:** `docs/operations/deployment-runbook.md` §8a records that every client binding in the login release was verified against **a stub written by the same agent that wrote the client, from the same reading of the same contract** — *"a shared misreading passes all 50 tests silently"* — and lists five checks no stub can make. That is this row's failure mode, observed. | Depends on AS1 (contract form and transport), which belongs to `API_STANDARD.md` and is not reconciled here. **Raise its priority.** It is no longer flagged *"before the first shared contract"*: contracts are shipped and two clients consume them. |
| TS4 | **OPEN** — architecture decision; blocks nothing | **Coverage targets.** Not specified anywhere. | Unchanged, and the recommendation now has a worked example. Do not set a percentage; require that every checklist item in every applicable standard has a test. **§5.3's denominator — query paths enumerated versus exercised — is the form that worked:** `apps/customers/README.md` records the enumeration for the first App as five storage functions and the query paths each serves, derived from the call sites rather than from the endpoint list, exactly as §5.3 demands. Required regardless of how TS4 resolves. |
| TS5 | **OPEN** — architecture decision; **dependency corrected 2026-09-06** | **No verification method exists for the non-disclosure-of-existence control.** §5.2 **requires** that *"for equivalent unauthorised requests, status, error shape, response-size class and timing distribution must not reveal whether another tenant or its resource exists"* — by user decision the requirement stands. What is undecided is how it is measured. Under Option A, D1 is single-threaded per database and `MULTITENANCY_STANDARD.md` §7.7 accepts cross-tenant latency coupling as structural, so timing is noisy and informative at once. | **TS5 must define: sampling method and sample size, the tolerance and statistical test that separate load noise from an existence-correlated signal, which surfaces are measured, and where the measurement runs.** The distinguishing question is correlation with existence, not variance: shared-D1 load variation is not a failure; a distribution that separates on whether another tenant's resource exists is. Until TS5 is resolved and implemented, the control is reported **`UNVERIFIED / NOT RUN`** (§5.7) and **never reported as passed without measurement**. It does **not** block Phase 0 — no runtime and no tenant data exist — and it **does** block any production release serving real tenant data. ~~Depends on TS1 for the harness.~~ `MULTITENANCY_STANDARD.md` §8 carries the identical sentence; the two files move together. **Two corrections, 2026-09-06. (1) The TS1 dependency is struck** — the harness exists (TS2). **(2) The evidence now argues for a structural answer rather than a statistical one, and it is measured evidence:** `docs/operations/deployment-runbook.md` §8 records that `core-agent` ran a wall-clock timing assertion **five times on identical code and it failed two of five**, and the runbook instructs *"Do NOT check this with a stopwatch."* The property is instead proved by identical `crypto.subtle.deriveBits` parameter traces across all thirteen refusal inputs — `packages/testing/suites/az2-login/equal-work.ts` — which holds on any machine. **That is a method for the authentication surface only, and generalising it is what TS5 now owes:** a structural equal-work proof per surface, with a statistical test reserved for what cannot be proved structurally. The phase note above also predates a runtime: a runtime and tenant data both exist now, so the second half of that sentence is the operative one. |
| TS6 | **OPEN** — Team Lead; **added 2026-09-06** | **Nothing runs any of this automatically.** §10 specifies a merge pipeline — format · lint · type check · unit · contract · security · build · integration · deploy staging · smoke. **`.github/` holds CODEOWNERS, a PR template and three issue templates, and no workflow file.** So `npm test` and `npm run typecheck` gate only when a human types them, and the suite's own history records the cost: `package.json:10` — `packages/testing` *"was checked by NOTHING until 2026-09-05, which concealed a fixture that had silently stopped composing what production composes while 400+ assertions kept passing."* | **`docs/operations/ci-roadmap.md`'s stated reason for creating no workflow has expired.** It creates none because *"the web framework and testing framework are still unselected"* — `0016` selected the web stack, and TS1 shows a runnable gate exists. **There is now something real to run**, which was that document's own condition. The honest remaining blockers are narrower: no lint or format tool is approved, and a deploy-staging stage must not be automated while every deploy needs explicit user approval each time (`0030`). **Recommend a first workflow of exactly two stages — `npm run typecheck` and `npm test`** — both of which pass today, which is what `0005` step 6 requires before either becomes a required check. `.github/**` and `ci-roadmap.md` are the Team Lead's; this row records the gap and does not close it. |
