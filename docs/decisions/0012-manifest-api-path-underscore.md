# 0012 — The manifest API path pattern must permit `snake_case` path parameters

- **Status:** **Accepted**
- **Date:** 2026-09-02
- **Deciders:** Dudo Team Lead, under authority the user delegated on 2026-09-01
- **Owning agent:** Team Lead records. Schema change implemented by `architecture-agent`.

## Context

`architecture-agent` found this while authoring the first App manifest, and correctly
refused to work around it.

`app-manifest.schema.json` constrains `apis[].path`:

```
^/[a-z0-9\-/{}]*$
```

The underscore is not in the character class. `API_STANDARD.md` §5 line 146 requires field
names to be **`snake_case` on the wire, consistently, everywhere**, and the standard's own
worked example at line 93 is:

```
/api/v1/orders/{order_id}/lines
```

That example **fails the schema**. Verified directly:

| Path | Result |
|---|---|
| `/api/v1/orders/{order_id}` | **REJECTED** |
| `/customers/{customer_id}` | **REJECTED** |
| `/customers/{customer-id}` | matches |

So the registry contradicts the standard it is supposed to encode, and the only paths it
accepts are the ones the standard forbids.

## The workaround that was correctly refused

`{customer-id}` validates. Writing it would have made the manifest pass and moved the slice
forward, at the cost of putting a `kebab-case` parameter on the wire in a platform that
mandates `snake_case`.

That is the same move as writing `retentionDays: 30` to unblock `0011` — a field bent to
accept a value that means something the author knows to be wrong. `architecture-agent`
declined it for the same reason and omitted the optional `apis` array instead, leaving
routes in the contract's `httpBinding` where they are expressed truthfully. Each Action
still declares its `public` exposure, so nothing is surfaced undeclared.

**Recording that refusal is part of this decision.** An agent that can make a red light turn
green by writing something slightly false will keep doing it unless the alternative is
available and expected.

## Decision

**Add `_` to the `apis[].path` character class:**

```
^/[a-z0-9_\-/{}]*$
```

Nothing else changes. Paths remain lowercase, remain rooted at `/`, and still admit only
segment characters, braces and hyphens. `snake_case` path parameters become expressible,
which is what the standard already requires.

## Why decided now rather than deferred

This is a manifest format change, so by the `0009` precedent it needs a record rather than
a quiet edit — it touches the SDK, Studio, `APP_STANDARD.md` and every future published
manifest.

The same argument as `0011` applies and is the reason to act today: **nothing consumes this
schema yet.** No SDK, no Studio, no runtime, no installation path, no published manifest. The
change is one character in a character class. Once a third-party manifest exists, correcting
a path grammar becomes a breaking migration.

Left alone, the cost is not theoretical: every App author hits it, and the cheapest way out
is the wrong one. A validator that only accepts non-conforming paths trains people to write
non-conforming paths.

## Consequences

- **`apps/customers/manifest.json` may declare its `apis` array** rather than omitting it.
  Whether it does is `architecture-agent`'s call; the block on doing so truthfully is gone.
- **No existing manifest is invalidated.** The change only widens what is accepted, so every
  currently valid path stays valid. Nothing needs migrating.
- **Fixture coverage is owed.** No fixture exercises `apis[].path` in either form.
  `qa-agent` should add a `snake_case` path case and a rejecting case (uppercase, or a
  space) so the grammar is exercised rather than asserted.
- **The schema and `API_STANDARD.md` now agree.** They did not, and the standard was right.

## Approval

Decided by the Team Lead under authority the user delegated on 2026-09-01. Flagged rather
than assumed: if path parameters should instead be `kebab-case` on the wire, then
`API_STANDARD.md` §5 is what is wrong and this record should be superseded — but that is a
change to the platform's wire convention and needs its own decision, not a character class
quietly settling it.

Related: `0011` (the same class of format defect, found the same way — by an agent refusing
to write a false value to satisfy a schema); `0009` (the precedent that a manifest-format
change needs its own record).
