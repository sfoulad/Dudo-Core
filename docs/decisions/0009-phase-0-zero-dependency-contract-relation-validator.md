# 0009 — Phase 0 zero-dependency contract relation validator

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** **User** (explicit written approval, 2026-09-01), Dudo Team Lead
- **Owning agent:** Team Lead records. Module authored by `architecture-agent`.

## Context

CodeRabbit raised CWE-863 (Major) and `qa-agent` found the same defect independently: an
`own`-scoped Action could be satisfied by an `ownershipField` on **any** entity in the
manifest, so an Action could target an *unowned* entity and still install.

AZ7 addressed the format half — `app-manifest.schema.json` now requires an `own`-scoped
Action to name its `targetEntity`. But the **referential** half cannot be expressed in JSON
Schema: comparing `actions[].targetEntity` against `entities[].name` is an instance-to-
instance value comparison, and draft 2020-12 has no keyword for it. `const` and `enum`
compare against literals fixed in the schema, not against other data in the document.

The consequence was stated plainly and not softened: **the exact exploit fixture `az7-n4`
validated clean and would install.** The manifest recorded enough to *detect* the mismatch;
nothing detected it.

Closing that gap requires executable code. Executable code in `Dudo-Core` normally means
Phase 1, a toolchain decision (`TS1`), and dependency installation — none of which are
approved.

## Decision

**One minimal executable contract validator is approved during Phase 0**, as a narrow
exception, for AZ7 semantic relationship validation only.

`packages/contracts/validation/app-manifest-relations.mjs`

A zero-dependency ECMAScript module using only the Node.js standard runtime. It accepts an
already-parsed manifest object, performs **no file, network, or environment access**,
returns deterministic errors, and **fails closed**.

It enforces what the schema cannot:

1. `targetEntity` is required for every `own`-scoped Action.
2. `targetEntity` resolves against entities declared in that same manifest.
3. Missing, unknown, duplicate, and ambiguous targets are rejected.
4. The **resolved** entity must itself declare `ownershipField`.
5. An `ownershipField` on an unrelated entity satisfies nothing — this is CWE-863.

### What this exception does NOT do

Stated explicitly so it cannot be read as a wedge:

- It does **not** approve `TS1`. The test framework remains undecided.
- It does **not** choose a package manager, build system, or test framework.
- It does **not** authorise installing any dependency.
- It does **not** start Phase 1.
- It does **not** create a production installation path.

No `package.json`, lockfile, compiler configuration, or test framework accompanies it. One
module file, run against the existing fixture harness.

### This is Foundation Gate tooling, not product runtime

The module exists to prove a contract rule during the Foundation Gate. **It is not the
product's installation-time validator**, and nothing in the product invokes it yet.

## Consequences

- **`az7-n4` — the exact CWE-863 exploit manifest — moves from ACCEPT to REJECT.** That is
  the test of whether this decision achieved anything.
- The positive owned-target fixture must continue to pass. A validator that rejects the
  exploit *and* legitimate least-privilege declarations is a defect, not a fix.
- **Every future manifest install or admission path must invoke this canonical validator
  before activation.** An App that has not passed it is not admitted.
- **Phase 1 must prove runtime integration using the same AZ7 fixtures.** Passing them here
  does not discharge that obligation; it establishes the conformance suite the runtime will
  be held to.
- **A future replacement is allowed only if it passes the identical conformance suite.**
  Rewriting the validator in whatever `TS1` eventually selects is expected — replacing it
  with something that passes a *different*, weaker suite is not.
- The precedent is narrow by construction: zero dependencies, no build step, no framework,
  one file, one rule family. It cannot grow into a toolchain without a new decision.

## AZ7 status language

Two distinct things, and they must not be collapsed — collapsing exactly this split
produced the earlier "not expressible in JSON Schema" overclaim that had to be retracted:

| | Status |
|---|---|
| **AZ7 contract enforcement** | **CLOSED** — schema for the format half, this validator for the referential half |
| **AZ7 Phase 1 runtime integration** | **NOT YET APPLICABLE** — mandatory before any install path ships |

**Do not claim a production runtime validator exists.** It does not.

## Review dispositions

### `maxLength: 64` on `$defs/entityName` — DECLINED

CodeRabbit's review of `685b99e` recommended restoring `maxLength: 64` to
`$defs/entityName`. It is not restored.

> **Declined by explicit user decision. No entity-name length policy has been approved. A
> reviewer suggestion cannot introduce a new product constraint.**

The keyword arrived incidentally while AZ7 was being implemented — it was never a decision,
and the user removed it to keep the change zero-delta beyond AZ7. Reinstating it on a
reviewer's suggestion would let a review introduce a product constraint that no record
approves, which inverts how decisions enter this repository.

`$defs/entityName` therefore carries `type`, `minLength: 1`, and `pattern` only.
`AUTHORIZATION_STANDARD.md` §4.1's enforcement table was corrected to match, so the
standard and the schema agree.

If an entity-name length limit is ever wanted, it is a product decision and needs its own
record.

## Approval

The user approved this exception in writing on 2026-09-01, enumerating both what it permits
and the six things it explicitly does not, and requiring that `az7-n4` change from
ACCEPT/INSTALL to REJECT while the positive owned-target fixture continues to pass.

Related: `0007` (logical permission model, **Proposed**) states the wildcard/scope
intersection rule; `0008` prohibits dependency installation without approval, which this
record honours by adding none.
