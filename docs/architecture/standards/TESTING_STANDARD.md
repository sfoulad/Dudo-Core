# Testing Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **No test framework is approved** — see §11. This standard is framework-neutral by construction.
- **Authored by:** `architecture-agent`. **Tests are authored by `qa-agent`.**
- **Applies to:** `packages/testing/**`, `apps/*/tests/**`, `connectors/*/tests/**`, and Apple test targets.
- **Depends on:** every other standard — the checklists in each are what tests verify.
- **Source:** master build plan §25, §26, §30, §31.

---

## 1. Who tests

**The test agent works independently from implementation** (master plan §25), and **the
agent that writes the implementation is never the final approving agent** (§26).

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
| **Tenant isolation** | Tenant A never reaches tenant B | Mandatory for every tenant-data feature. §5. |
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

The canonical test:

> Create tenant A and tenant B with equivalent data. Acting as a **fully privileged**
> principal in tenant A — an owner holding every permission — attempt to **read, list,
> update, delete, export, enumerate, and infer** tenant B's records through every surface
> the feature exposes: public API, internal API, event consumption, workflow, file access,
> search, and MCP.
>
> Every attempt returns `not_found` or an empty result. No response body, error message,
> status code difference, log line, or timing difference reveals that tenant B's data
> exists.

Also asserted:

- Cross-tenant access returns `not_found`, **never `forbidden`** (`API_STANDARD.md` §8).
- Cache keys, object keys, queue messages, and scheduled jobs carry the tenant.
- No log line or error message contains a foreign tenant identifier or business data.
- **Fixtures and seeds contain no cross-tenant reference.** Cross-tenant access in a
  fixture is a critical defect exactly as in production code.

The privileged principal matters: an under-permissioned principal fails for the wrong
reason and proves nothing about isolation.

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

From master plan §30. A task is complete only when **all** hold, verified and reported
honestly:

- [ ] Code compiles.
- [ ] Type checking passes.
- [ ] Unit tests pass.
- [ ] Contract tests pass — producer and every consumer.
- [ ] Integration tests pass.
- [ ] **Tenant-isolation tests pass.**
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

---

## 10. CI

Every merge runs, in order (master plan §36): format · lint · type check · unit test ·
contract test · security checks · build · integration test · deploy staging · smoke test.

- **A check that has never run is not a passing check.** Nothing becomes a required check
  until it has passed for real at least once (`0005` step 6).
- Migrations run through controlled deployment workflows, never ad hoc.
- Production deployment happens only after all gates pass **and** the user approves.

---

## 11. Open questions

| # | Question | Recommendation |
|---|---|---|
| TS1 | **No test framework is approved.** The plan mentions Vitest against the Workers runtime (§31); `0003` approves no npm package. | Needs an ADR **before any test is written**. Recommend the framework that can execute against the real Workers runtime rather than a Node emulation — testing Workers code in Node proves the wrong thing. `qa-agent` should evaluate and the Team Lead record it. **This blocks Phase 1 verification.** |
| TS2 | **Test data for the tenancy model** depends on a model that is not decided (`MULTITENANCY_STANDARD.md` MT2). | The isolation test in §5 is written to be model-independent; the harness that provisions two tenants is not, and waits on MT2. |
| TS3 | **Cross-repository contract testing.** `Dudo-Apple` is a separate repository, so verifying it against `Dudo-Core`'s contracts needs a distribution mechanism. | Depends on AS1 (contract form and transport). Flagged before the first shared contract. |
| TS4 | **Coverage targets.** Not specified anywhere. | Do not set a percentage. Require instead that every checklist item in every applicable standard has a test. A percentage is satisfiable without testing anything that matters. |
