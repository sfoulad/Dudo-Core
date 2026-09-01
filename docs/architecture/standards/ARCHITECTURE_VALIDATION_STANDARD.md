# Architecture Validation Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance. **This standard imposes a gate, not a feature.**
- **Authored by:** `architecture-agent`.
- **Applies to:** the platform as a whole, before many business Apps are built on it.
- **Depends on:** `CONSTITUTION.md`; `ARCHITECTURE.md`; `APP_STANDARD.md`; `CAPABILITY_STANDARD.md`; `TESTING_STANDARD.md`; `docs/decisions/0005` (Foundation Gate).
- **Applies from:** Phase 4.

---

## 1. The requirement

The requirement, in full:

> **Before building many Apps, validate the platform with two very different applications.**
>
> **Application A — Appointment Business:** Customer · Appointment · Employee · Service ·
> Notification · Payment
>
> **Application B — E-commerce:** Customer · Product · Cart · Order · Payment · Inventory ·
> Shipping · SMS
>
> If the same platform architecture supports both cleanly **without Core modifications**,
> the foundation is moving in the right direction.

**This is binding, and it is a gate.**

> **No broad programme of business App development begins until the First Architecture
> Validation has been executed against two materially different applications and its
> findings have been recorded and dispositioned by the Team Lead with user approval.**

"Materially different" is the whole point, and the pairing is well chosen: an appointment business
is scheduling, human availability, and time; e-commerce is catalogue, inventory, and
fulfilment. An architecture that fits two applications which resemble each other has
demonstrated nothing.

---

## 2. Why this exists, and what it is protecting

`CONSTITUTION.md` §6 states the principle:

> **Never solve today's requirement in a way that prevents tomorrow's application from being
> built independently.**

That principle is unfalsifiable until something tries to falsify it. Every architecture is
adequate for the first application built on it, because the first application is what it was
designed against. The second, different one is the first real evidence — and the cost of
learning from it rises steeply with every App built in the meantime, because a Core change
after ten Apps is a change to ten Apps' assumptions.

**This is the cheapest moment to find out the architecture is wrong.** That is the entire
justification for spending Phase 4 effort on validation rather than on shipping.

---

## 3. What must be validated

Both applications must be built far enough to genuinely exercise **all six** areas. A
validation that exercises four of six has validated four of six and is reported that way.

| # | Area | The question it answers | What "exercised" means, concretely |
|---|---|---|---|
| 1 | **Contracts** | Can two unlike Apps express their domains through published contracts without a contract change made to suit one of them? | Each App declares entities, Actions with declared input/output schemas, and API exposures; each consumes at least one Core contract and at least one Capability contract |
| 2 | **Permissions** | Does `Principal + Role + Permission + Scope` express two different real authorization models? | Each App declares its own namespaced permissions; roles are exercised at more than one scope; a denied path is tested, not only an allowed one |
| 3 | **Events** | Can Apps coordinate without coupling, and does the shared envelope survive two publishers? | At least one event published by one App and consumed by another; envelope, versioning, idempotency, and at-least-once delivery all exercised |
| 4 | **Files** | Does tenant- and App-scoped object storage work for two different file shapes? | Each App stores and retrieves objects under `t/<tenant_id>/<app_id>/`; at least one user-uploaded file |
| 5 | **Extensibility** | Do UI extension locations, capability requests, and the App lifecycle hold for two unlike Apps? | Each App registers into declared UI extension locations; each requests capabilities by capability, never by vendor; install, configure, upgrade, disable, and uninstall are all executed |
| 6 | **Tenancy** | Is isolation a property of the architecture, or of these two Apps' code? | The canonical isolation test (`MULTITENANCY_STANDARD.md` §8) runs against **both** Apps across every surface each exposes |

**The shared-concept test, which is where architectures usually fail.** Both applications
have a **Customer** and both take a **Payment**. That overlap is deliberate and must be
exercised, not designed around:

- Does `Customer` belong to a Customers App that both consume, and does consuming it feel
  like a contract rather than a shared table? **Rule 3 forbids the shared table**; the
  validation must prove the contract is sufficient, not merely that the rule was obeyed.
- Do both reach payment through the **Payment Capability** (`Finance → Payment Capability →
  Connector`), with neither naming a provider anywhere in its source
  (`CONSTITUTION.md` Rule 6)?
- Does `PaymentReceived` mean the same thing to both, from one registered event definition,
  or did two near-duplicate concepts appear (`EVENT_STANDARD.md` §8)?

---

## 4. The three outcomes, and what each obliges

Every finding is recorded as exactly one of these. **The categories are the deliverable** —
a validation that produces only "it worked" has not been performed rigorously.

| Outcome | Definition | Required response |
|---|---|---|
| **Succeeds** | The App expressed the requirement through existing platform mechanisms, with no Core change and no exception | Record it. This is evidence the primitive is right, and it is worth stating explicitly so that later doubt has something to check against |
| **Bends** | It worked, but through a workaround, an awkward shape, a duplicated concept, or an unwritten convention the App author had to invent | **Record it with the workaround written out in full.** A bend is a defect in the platform that was paid for by the App. Two Apps bending the same way is a missing primitive |
| **Fails** | It could not be done without modifying Core, or could not be done at all | **Stop and report to the Team Lead immediately.** A Core change to serve one business domain is exactly what `CONSTITUTION.md` Rule 1 forbids, and the success criterion in §1 is "without Core modifications" |

**A Core modification requested during validation is a finding, never a task.** The response
is to record what the App needed and why Core could not provide it, and route it to the Team
Lead as an architecture question. An agent that "unblocks" validation by editing Core has
destroyed the experiment and produced a false pass.

---

## 5. When this runs

- **After** the Core platform, the application runtime, and the SDK exist — the validation
  must run against the real SDK a third party would use — *"these must use exactly the same
  SDK available to third parties"* (`SDK_STANDARD.md` §1).
- **Before** a broad programme of business App development. The plan says "before building
  many Apps"; this standard reads "many" as **more than the two validation applications
  themselves**.
- The two validation applications may be, and probably should be, the first two official
  Apps. Building throwaway prototypes would validate a throwaway.

**Relationship to the delivery gates:**

- **Neither validation application needs to become a production release during the
  Foundation Gate.** `0005` suspends the runnable-release steps for Phases 0–3 precisely
  because foundation work produces nothing a user can open, and the purpose here is
  evidence about the architecture, not a shipped feature.
- **This does not exempt either application from the full delivery gate if and when it
  ships.** `0005` is explicit that the full seven-step gate is triggered by work becoming
  runnable, not by a phase number. A validation App that is later released to users passes
  the full gate then, on its own merits.
- The validation is complete when its **report** is complete and dispositioned — not when the
  applications are feature-complete.

---

## 6. The deliverable

A written validation report, owned by `architecture-agent`, reviewed by `qa-agent`, recorded
by the Team Lead, and approved by the user under `0005` step 7. It contains all eight:

1. **What was built**, per application, with the entities and Actions actually implemented —
   and what was *not* built, stated plainly.
2. **A findings table**: every finding as succeeds / bends / fails, per the six areas in §3,
   with the shared-concept results (Customer, Payment, `PaymentReceived`) called out
   separately.
3. **Every bend written out in full** — the workaround, why it was needed, and what primitive
   would have removed it.
4. **Every Core change requested**, whether or not it was made, with the reason Core could
   not serve the need.
5. **Test evidence**, reported as `qa-agent` actually observed it: passed, failed, skipped,
   not run. Including the isolation test result for both applications, across every surface
   each exposes.
6. **What could not be validated and why** — an unapproved dependency, a missing decision, a
   surface that does not exist yet. Naming a gap is a result; assuming past it is not.
7. **An explicit answer to §1's question:** did the same architecture support both
   applications cleanly, without Core modifications? Yes, or no, or with these exceptions.
8. **A recommendation** on whether broad App development should begin, and any decision
   record the findings require.

**The report is not a sign-off.** `architecture-agent` supplies evidence; `qa-agent` verifies
independently; the Team Lead dispositions; the user approves. `CONSTITUTION.md` §4.1 — the
agent that writes an implementation is never the final approving agent — applies here in
full: the agents that build the two applications do not judge whether the architecture passed.

---

## 7. What would count as a real failure

Recorded in advance, so the criteria cannot be relaxed once results are in. **This is the
point of the exercise, and pre-committing the failure conditions is what makes it an
experiment rather than a demonstration.** Any of the following is a `fails`:

- Either application needs a change to `platform/core/**` to serve its business domain
  (Rule 1).
- Either application needs to read the other's data other than through a published contract
  or an event (Rule 3).
- The same business concept has to be modelled twice because the platform could not express
  it once — two `Customer` entities, two `PaymentReceived` events.
- A permission the model cannot express, or a scope that has to be widened to make a
  legitimate operation work.
- An App has to know a vendor's name (Rule 6), or a Cloudflare type (Rule 11).
- An operation that cannot carry tenant context through one of the eleven carriers
  (`MULTITENANCY_STANDARD.md` §4).
- The isolation test cannot be written for a surface either application exposes.
- An Action that cannot be exposed identically to a human and to an AI principal (Rule 8).

---

## 8. Verification checklist

- [ ] Two materially different applications built — Appointments and E-commerce, per §1.
- [ ] Both built against the same SDK a third party would use; no privileged path taken.
- [ ] All six areas in §3 exercised, and any area not exercised is named as not exercised.
- [ ] Shared concepts exercised, not avoided: one `Customer` contract, one Payment Capability,
      one `PaymentReceived` definition.
- [ ] Every finding categorised succeeds / bends / fails; every bend written out in full.
- [ ] No Core modification made to unblock either application; every request recorded instead.
- [ ] Isolation test executed against both applications across every surface each exposes.
- [ ] Install, configure, upgrade, disable, uninstall, and data disposition executed for both.
- [ ] Test results reported as observed — passed, failed, skipped, not run.
- [ ] Report delivered, independently reviewed by `qa-agent`, dispositioned by the Team Lead,
      approved by the user.
- [ ] Broad App development has not begun before that approval.

---

## 9. Open questions

| # | Question | Status |
|---|---|---|
| AV1 | **How complete must each application be?** Enough to exercise the six areas is the criterion here; nothing quantifies it further. | Recommendation: the smallest slice that exercises all six honestly, chosen per application and stated in the report. Team Lead confirms before Phase 4 planning. |
| AV2 | **Phase 4 is planned around four official Apps** (Customers, Appointments, Commitments, Finance Health); **§1 requires Appointments and E-commerce.** E-commerce is not in the Phase 4 list. | Unresolved. The validation needs the *difference* between the two, and Commitments and Finance Health are closer to Appointments than E-commerce is. Team Lead decides which Apps constitute Phase 4. |
| AV3 | **Both applications need a Payment Connector**, and Connectors are Phase 5 — after Phase 4. | An ordering conflict between the two phases. Either the payment path is validated with a test provider, which validates the capability boundary but not a real Connector, or Phase 5 partially precedes Phase 4. Team Lead decides; the report must state which was done. |
| AV4 | **Application B needs SMS**, which is a Capability with no approved provider. | Same shape as AV3. A test provider validates the interface, not the integration; the report must not claim otherwise. |
| AV5 | **Which gate applies to the validation applications** if either is released to users. | `0005` says the full gate is triggered by runnable work. Team Lead states which gate applies when assigning the work, per `CONSTITUTION.md` §4.5. |
