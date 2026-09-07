# packages/testing/ — Test suites and shared harness

**Owner: `qa-agent`** (see `docs/architecture/boundaries.md`)

Cross-cutting test suites and the shared test harness: unit, integration, contract,
security, tenant-isolation, and regression coverage.

> Moved here from `tests/` by `docs/decisions/0004-repository-structure.md`.

Per-App suites colocate with their App under `apps/<name>/tests/` as Apps are built.
`qa-agent` owns those too — the location changes, the ownership does not.

## What lives here

- Contract tests binding the producer and **both** consumers — the web client and the
  Apple client — against one published contract set.
- Tenant-isolation suites.
- Authorization and permission suites.
- Cross-App integration and regression suites.
- Shared fixtures, factories, and harness utilities.

## Rules

- **Synthetic data only.** Never real customer data. Never a secret, token, or
  credential — including in expected output.
- **Never weaken a test to produce a pass.** No deleted assertions, no added skips, no
  widened tolerances, no stubbing past a real failure. A failing test that describes
  reality is a deliverable.
- **Report actual results** — passed, failed, skipped, not run. Never round a partial run
  up to "all passing", and never report a suite that was not run.
- **Tenant isolation is a first-class target.** For every feature touching tenant data,
  prove tenant A cannot read, write, enumerate, or infer tenant B. **A missing isolation
  test is itself a defect.**
- QA never edits production code. Defects route to the owning agent through the Team Lead.
- **Root-level shared test configuration belongs to the Team Lead**, not to QA. QA
  proposes changes to it — see `docs/decisions/0001-governance-and-decision-sequencing.md`.

## Running the type-negative harness

```
node packages/testing/run-type-negative.ts
```

**The only check in this repository that can see a type-level guarantee being removed.** Two
controls are enforced by the type system and by nothing else — `MembershipAdmission` (`M-1`) and
`ControlPlaneWriteReservation` (`0014` §A.11). Relax a signature to `admission?:` or export a
private mint and `npm run typecheck` stays green, **every suite here stays green** — Node strips
types without checking them — and the guarantee is gone with nothing saying so.

The fixtures under `type-negative/cases/**` exist **to be compiled and to fail**. A second `tsc`
invocation compiles them and the runner asserts three properties:

| # | Property | What it catches |
|---|---|---|
| 1 | the project must **fail** to compile | every negative case started compiling |
| 2 | every `// @expect-error TSxxxx` line produced **that code** | it failed for a different reason — *"it didn't compile" passes on a missing semicolon* |
| 3 | **no unmarked line produced any diagnostic** | a fixture that broke, or a **control line that stopped compiling** |

**Property 3 is the one that makes it a test.** A probe that dies on a bad import exits non-zero
and satisfies property 1 while having checked nothing — that is exactly how the first hand-run
probe of this guarantee read as a success. It also means the **control lines need no separate
assertion**: "produced no diagnostic" is already required of every unmarked line.

**The two receipts are deliberately NOT symmetric, and the asymmetry is asserted rather than left
as a gap.** `mintMembershipAdmission` is module-private, so "the mint cannot be named from
outside" is a negative case. `mintControlPlaneWriteReservation` is **exported on purpose**, so the
same fixture would fail for a *correct* reason — it is a **control line that must compile**
instead. Making the two match, in either direction, turns this run red.

**What it does not prove:** that the guarantee holds at runtime. A deliberate `as never` cast
defeats every case here. That is why `M-1` also has a guard in the SQL and an emitted-statement
assertion in `suites/platform-operator/membership-write-guard.ts`.

`type-negative/tsconfig.json` **extends the root** and overrides only `include`/`exclude`, so the
probe always checks the same language the product is compiled with. No root file is changed and no
dependency is added — the fixtures import from `platform/core` only and touch no Node API.

## Running the platform-operator (super-admin) suite

```
node packages/testing/run-platform-operator.ts
```

Covers the fourth request class: `docs/decisions/0024`'s two invariants, `0025`'s five
decisions, `0026`/`0027`'s confirmation mechanism, `organization-onboarding-v1`, `template-v1`,
and `platform-operator-v1`'s binding properties P1, P2 and P4. It builds a control-plane
database from all thirteen real migrations, **a second `node:sqlite` database for the tenant
side**, and composes the shipped `platform/composition.ts` over the shipped D1 adapter — so
nothing about the class is simulated except the SQL engine.

**TWO DATABASES, BECAUSE ONBOARDING IS AN OPERATION ACROSS TWO.** `onboarding-service.ts` states
that control-plane writes and tenant writes are two databases with no batch that commits both,
and the `201 with warnings` ruling exists because of it. A single harness database would make
that problem invisible and the warnings path untestable.

A **primary run**, then **six negative-control runs**:

| # | Control | What it breaks |
|---|---|---|
| 1 | the mutual-exclusion probe | `principalHasAnyMembership` always answers `false` |
| 1b | the Action-side mutual exclusion | `findPrincipal` reports `holdsMembership: false` |
| 1c | **both halves at once** | both of the above |
| 2 | the audit record | every write silently succeeds and stores nothing |
| 3 | the host binding | the application host is added to `adminHosts` |
| 4 | **`0027`'s central control, across BOTH gated classes** | `ConfirmationGate.enforce` returns `ok` for everything, in the Action pipeline **and** in the platform route class |

**Standing requirement, and it generalises beyond this suite: wherever an invariant is enforced at
N points, the suite needs a control that removes all N — not N controls that each remove one.**
Defence in depth and negative-control coverage pull in opposite directions. Every layer added makes
the suite less able to detect that any single layer has died, and a control that removes one of two
redundant checks prints green and means nothing — it will keep printing green after both checks
rot, as long as they rot one at a time.

**Controls 1 and 1b cannot be read on their own, and 1c is why.** The invariant is enforced at two
independent points reading two different statements, so the platform routes still refuse a
both-tables principal under either control alone — defence in depth working, and also the way a
negative control quietly stops controlling. Only 1c, with every enforcement point removed, can
show that the "every platform route refuses" case tests the invariant rather than testing nothing.
It turns all three isolation cases red; the cases that stay green under it are the `0010` trigger
and schema cases, which correctly do not depend on a runtime check.

**Control 3 is read differently again.** `0025` requires that the host binding
be defence in depth and never the first layer, so the AUTHORIZATION suite is re-run under it
and **must stay green** — an authorization suite that is indifferent to the hostname is the
evidence that routing is not doing the authorizing.

**Control 4 is `docs/decisions/0027`'s central negative control, and it now removes the gate from
BOTH places it is enforced.** `0027` asks for *"remove the confirmation check from the pipeline and
every critical-operation test must go red."* The gate is enforced at two independent points —
`action/pipeline.ts` step 6 and `dispatchPlatformRoute` step 5b — and each composes its own
instance, so a control reaching only one leaves the other enforcing.

**Until 2026-09-05 it reached only the pipeline and still printed `STILL GREEN: 0`.** That zero was
true of the two suites the control was applied to and said nothing about the class it never
touched — the standing requirement below, failing quietly. The run now wraps both fixtures in one
pass and classifies the results together, so the same `0` is a strictly stronger claim over four
suites instead of two.

**`STILL GREEN: 0` IS KEPT BY SPLITTING SUITES BY SCOPE, NEVER BY EXPLAINING A GREEN AWAY.** Four
cases about the platform gate are legitimately indifferent to whether it refuses — the structural
`isConfirmationGated` claim, the positive control, the authorization-orders-first case, and the
uncomposed-gate case, which has no gate to break. They live in
`buildPlatformConfirmationScopeSuite` and are not run under the control. Left in place they would
print four still-greens every run with a standing footnote, and *the explanation would then have to
be made correctly every run* — which is how a real gap eventually gets waved through.

**No route in the shipped platform table is confirmation-gated today**, so the platform half of the
control runs against a synthetic critical route built from shipped pieces
(`platform-fixture.ts::createSyntheticCriticalRoute`). That is reported as the finding it is rather
than hidden: the class's gate currently guards nothing, which is `M-1`'s shape exactly. A case
asserts that emptiness, so the day a real gated route lands, the suite says so.

### Two standing controls that are not about one feature

| Suite | What it holds |
|---|---|
| `suites/platform-operator/registry-coherence.ts` | `permission-catalog.yaml` against Core's frozen transcriptions — the comparison `critical-permissions.ts` names as owed to `qa-agent` and calls *"the only thing standing between the catalog and this list"*. It had never been written, and it was already red when it was: `core.principal.revoke-platform-scope` was `critical` in the catalog and absent from Core, so it required no confirmation. Fixed by `core-agent` the same day; this suite is why it cannot recur silently. |
| `suites/platform-operator/business-type-boundary.ts` | `0025` decision 2 — no identifier in `platform/core/**` may name a business type. Written by `core-agent` in its own harness and handed to tests, because a control in the author's scratch harness runs when the author remembers. |

Both read files rather than building a world, so neither runs under a negative control — there is
no runtime port to break. Both assert a **floor on what they parsed before comparing anything**:
the catalog reader's first version handled only block-form YAML sequences and returned an empty
list for the inline-form roles, and an empty list compared against Core would have printed green
while comparing nothing.

### What is NOT covered by this run

`packages/testing` is **excluded from the root `tsconfig.json`**, deliberately and with the
reason recorded there: it is Node code and the root config targets a Worker. So these suites
are **not typechecked by `npm run typecheck`**. The `platform/core` half they exercise is.

**`npm run typecheck:tests` covers them, and it is currently GREEN** (0 diagnostics, from 14 on
2026-09-05). It is a separate command from `typecheck` on purpose — a red gate inside a green one
makes the green one worthless — and wiring the two together is the Team Lead's call, not QA's.

Three of the fourteen were fixture drift of exactly the class the config was added for: the
platform fixture had stopped passing `templates` and `onboarding` to a composition root that
required both, a `Clock` literal supplied `nowMs` and not `now`, and a recorded-request array had
quietly narrowed to three of a port's four fields. **All three ran green.** Node strips types
without checking them, so a double that has stopped matching its port keeps reporting on a shape
the product no longer has.

One diagnostic was cleared by an annotation rather than a fix, and the reasoning is written at the
site (`suites/az2-login/kdf-vectors.ts`): TypeScript reported the composed/decomposed vector
comparison as a tautology, **which it only does while the vectors are still correct** — if the file
were ever normalised on disk the diagnostic would vanish and the runtime assertion would go red.
A signal that fires when things are right and goes silent when they are wrong is not one worth
keeping a gate red for.

## Running the Customer Directory suite

```
node packages/testing/run-customer-directory.ts
```

Node 22 runs TypeScript directly by stripping types. There is **no build step, no
configuration file, no runner package and nothing installed** — `0003` approves TypeScript
on Cloudflare and **no npm package**, and **TS1, the testing framework, is unresolved**.
The runner in `harness/runner.ts` is deliberately ~150 disposable lines: when TS1 is
decided, the suites move and it is deleted. `node:sqlite` and `node:test` are both Node
built-ins; `node:sqlite` is used because it is a real engine, and `node:test` is **not**
used because adopting it would be a TS1 decision that is not QA's to make.

### What the run prints

A **primary run**, then **six negative-control runs**, as `TESTING_STANDARD.md` §5.6 requires
each separately. For every control each case is classified as *red on an isolation assertion*,
*red on another assertion*, or **STILL GREEN**.

| # | Control | What it breaks |
|---|---|---|
| 1 | the predicate | `tenant_id = ?` removed from the real compiler's output |
| 2 | the resolver | every request is handed Organization B's store |
| 3 | the boundary | the query path reaches the engine without the Core-owned port |
| 4 | D2 reverted | `GetCustomer` back to `auditOnDenial: false` |
| 5 | the group key | the requested identifier is back in it (`0013` control 5) |
| 6 | the write admission | every reservation is replaced with a valid one (`0014` §A.11) |

**Read the STILL GREEN line differently for controls 1–3 than for 4–6.** Controls 1–3 break
tenant isolation, which every case in the isolation and storage-path suites claims to test, so
a case that stays green there is a real coverage gap. Controls 4–6 break one narrow mechanism
each, and most cases legitimately do not touch it — a ceiling-arithmetic case staying green
under the write-admission control is correct, not a gap. What matters for 4–6 is that the cases
which DO claim the mechanism go red.

### Layout

```
harness/runner.ts              the runner, the assertions, and `expectError`
harness/sqlite-d1.ts           node:sqlite behind the D1 port, recording every statement
harness/broken-controls.ts     the deliberately broken storage controls
harness/broken-coordination.ts the deliberately broken coordination controls (0013, 0014)
harness/world.ts               the two-Organization fixture, all synthetic
suites/customer-directory/     the suites
run-customer-directory.ts      the entry point
```

**The breaks are never committed as configuration.** `broken-controls.ts` and
`broken-coordination.ts` contain no edit to `platform/core/**`: the predicate control removes
the tenant term from the REAL compiler's output, the coordination controls wrap the REAL
`in-process-coordinator.ts`, the admission control wraps the REAL `createD1TenantStore`, and
production code has no switch that turns any of it off.

### The request coordinator and the day ledger

Since `docs/decisions/0013` the pipeline requires a `RequestCoordinator`, and since `0014` §A
that coordinator also holds the daily D1 write budget every mutation reserves from. The harness
supplies Core's own `platform/core/protection/in-process-coordinator.ts` — which exists for
exactly this purpose and is marked never-for-deployment. A harness-local coordinator would
verify the harness's algorithm rather than the shipped one.

**The Durable Object adapter is not executed by anything here** — there is no Worker
configuration and no runtime — so persistence, eviction and restart of the coordinator and of
the day ledger are **not covered**, and are reported that way rather than implied by a green
run.

### The index-count check

`storage/write-cost.ts` says, honestly, that nothing can catch a cost declaration that counts
statements correctly and index rows wrongly, because D1 exposes no portable schema
introspection through the binding — so it is "a review obligation, stated as one".

**This harness is not D1.** The migrations are executed into a real SQLite database, so
`PRAGMA index_list` answers what D1 will not, and the write-admission suite computes every
table's true cost from the live schema and compares it with the declared constants and with
what each Action actually reserves. Add an index to a migration without moving the number and
the suite goes red. The review obligation still stands for a **deployed** database whose schema
this harness does not see.
