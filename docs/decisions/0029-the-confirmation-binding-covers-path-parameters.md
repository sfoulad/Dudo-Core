# 0029 — The confirmation binding covers path parameters

**Status:** accepted, 2026-09-05
**Supersedes:** `0027`'s definition of the bound parameter set, struck in place in
`confirmation-v1`
**Required by:** `.claude/rules/architecture.md` §1 — a breaking change to a published contract
needs Team Lead review and a decision record. This is that record.

## The defect

`platform-operators-v1` promised, in terms:

> *"a confirmation obtained to revoke operator A cannot be spent revoking operator B."*

**The binding would have covered the empty object.** Verified in code rather than reasoned:
`splitConfirmedRequest` builds `parameters` by iterating the request body and dropping the three
confirmation fields, and **nothing else is ever added**; `dispatchPlatformRoute` passes only the
validated flat body, and **path parameters are not in it**; and `revokeOperatorInput` requires
exactly `confirmation_id`, `reauth_derived_value` and `identifier` and nothing more.

So body-minus-three was `{}`, and **a confirmation minted to revoke one operator would have been
spendable on any other** — on the route that revokes platform scope, whose entire safety argument is
that it is confirmed.

**It was caught by a load-time guard, not by review.** `assertConfirmationCoverageIsCoherent`
refused a shape it could not prove safe and forced the question upward instead of letting a
plausible route ship.

## Why review did not catch it

The restatement **asserted rather than hedged**:

> *"The challenge's `parameters` are the body minus the three confirmation fields, **so** the binding
> covers `principal_id`."*

**The premise was true, the conclusion was false, and the word "so" was doing work it could not do.**
A reviewer checking whether the target was bound found a sentence saying it was, and stopped. That is
`architecture.md` §3b in a new place, and the narrow check that would have caught it is worth
stating:

> **For any route asserting that its binding covers a value, confirm that value appears in the
> parameters object as the DEFINITION computes it — not as the sentence assumes it does.**

## Decision — bind the path parameters

**Rejected: moving the target into the body.** It needs no mechanism change, and
`platform-operators-v1`'s own reasoning against it is sound — the target is the path parameter and
not a body field, **so there is exactly one place it can come from and no possibility of a body and
a path disagreeing.** A body/path pair is a precedence rule, and **a precedence rule is a place for a
caller to shadow a value a reviewer assumed was authoritative.**

**Accepted:** the bound object is the request body minus the three confirmation fields, **union the
route's declared path parameters.** Query parameters and object fields stay refused on gated routes.

### The path template is the declaration, which is why this adds no list

The hard part was not widening the set — it was widening it **without replacing one list with
another**. *"Plus the path parameters"* is unusable if a client must be **told** which those are;
that would destroy the property the word *exactly* existed to protect.

**It is not a new thing to know.** A client cannot issue the request without the path template and
the values it substituted — **constructing the URL is already holding both.** The declared names are
the brace-delimited segments of the route's path in `httpBinding`. The client derives them from the
same string it already used; the server derives them from the same template in its route table.
**One source, two readers, no list.**

### Three mechanical rules, without which two conforming implementations differ

- The bound value is the **decoded** segment, never percent-encoded.
- It is always a **JSON string**, never coerced — a numeric-looking segment binds as `"42"`.
- **Order is irrelevant**, because canonical serialisation already sorts keys.

The web and Apple clients would have diverged on the second.

### Disjointness, which is load-bearing rather than hygienic

**Path parameter names must not collide with body field names or the three confirmation fields,
checked at construction.** A union with a collision **is** a precedence rule — reintroducing inside
the binding the exact ambiguity that rejecting the body option avoided.

## The guard inverts

It refused path parameters on gated routes; it must now **require them to be bound.**

**The old rule was correct for a reason that expired**, which is different from a rule that was
wrong. It was written to stop *the human confirms one target, the request carries another*. **The
real requirement was never "no path parameters" — it was "nothing outside the binding."** Refusing
them achieved that by making the case unreachable, which was honest when no gated route existed and
wrong the moment one did. Distinguishing those is what makes this a **widening rather than a
reversal**, and it is why the contract carries the argument rather than the rule: whoever next
considers query parameters should meet the reasoning.

**Empty `parameters` stays legitimate and becomes verifiable** — correct exactly when the route
declares no path parameters and no body fields beyond the three, **a property a reviewer confirms
from the route definition instead of a coincidence of what the body happened to contain.**

## Timing — this was free at exactly one moment

This is a breaking change to a published contract, and it has **zero consumers that compute the
binding**, because **no gated route exists yet.** The first one is the route that prompted it.

`platform-routes.ts` carried the mirror of the defect in a comment written the same day: *"a gated
route may declare no path parameters, so this IS the whole of the route's input"* — true only while
none existed. **One day later this becomes a coordinated migration across Core, web and Apple.**

## The residue was in the test list, which is where §12 predicts it

Two assertions **instructed**, and both would have produced a green run over this defect:

- *"Alter one parameter between challenge and submission. Refused."* Under the struck definition
  *parameter* meant a body field, so it **passes vacuously on every route whose only variable is a
  path segment.**
- The case labelled **THE CENTRAL TEST OF THIS CONTRACT** — *confirm a delete of customer X, submit
  a delete of customer Y* — varies a **body** field. On operator revocation **it is not constructible
  at all.** A suite running it would have reported the contract's central property as **covered**
  while the only axis that route has went untested.

The path-substitution case is added **separately**, because neither subsumes the other. **It must be
shown to go red against the struck definition, or it has verified nothing.**

**Checked and stated as a negative:** no client obligation and no risk assessment reasons from the
struck definition. The locale exclusion survives intact — widening what `parameters` contains does
not make locale one of them.

## Consequences

- `core-agent` implements the guard from the contract's assertable form, then registers
  `platform.operators.revoke`.
- `qa-agent` owes the negative control: mint to revoke A, spend on B changing only the path segment.
- Both clients compute the union. **Neither needs a new input** — only the template each already
  holds.
