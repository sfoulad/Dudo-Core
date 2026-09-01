# 0011 — `retain` means indefinite: the manifest lifecycle format change

- **Status:** **Accepted**
- **Date:** 2026-09-01
- **Deciders:** Dudo Team Lead, under authority the user delegated on 2026-09-01
  ("Keep going and you decide")
- **Owning agent:** Team Lead records. Schema change implemented by `architecture-agent`.

## Context

The user decided the customer retention model on 2026-09-01:

- Archived customers are retained **indefinitely** until an authorized user requests
  permanent deletion.
- A permanent deletion has a **30-day recovery period**.
- After 30 days, personal data is purged.
- **No automatic purge may remove an active or merely archived customer.**

`architecture-agent` then found that `app-manifest.schema.json` cannot express it, and
correctly refused to write `30` into the field that was available. The finding is worth
stating precisely, because the trap is subtle:

```
lifecycle.retentionDays  — "Required when onUninstall is 'retain' or 'archive'."
                           minimum: 0
```

`retentionDays` means **how long tenant data is held after the App is uninstalled**. The
decided 30 means **how long an explicit deletion of one customer can be undone**. Different
trigger, different subject, and opposite outcomes at the end of the clock.

Writing `lifecycle: { onUninstall: retain, retentionDays: 30 }` would assert that thirty
days after uninstall the Organization's entire customer directory is disposed of. That is
the exact opposite of the decision, and `APP_STANDARD.md` §9 requires the manifest to be
true **on the uninstall screen** — the one place a tenant reads it before acting
irreversibly.

`retentionDays: 0` is worse, not a workaround. It reads as "retain for zero days."

So the App manifest could not be authored truthfully at all, and the slice was blocked on a
schema defect rather than on a missing number.

## Options considered

1. **Add a sentinel value** — allow `retentionDays: -1`, or the string `"indefinite"`, to
   mean unbounded. Rejected: a magic number in an integer field is a comment pretending to
   be data, and a mixed-type field is worse. Every consumer must know the sentinel or it
   silently reads as a duration.
2. **Add a second field** — `retentionPolicy: [indefinite | bounded]` alongside
   `retentionDays`. Rejected: two fields that must agree is a new way to be inconsistent,
   and nothing enforces the agreement except more conditional schema.
3. **Make `retain` mean indefinite, by definition.** Chosen.

## Decision

**`onUninstall: retain` means the data is retained indefinitely.** Under `retain`,
`retentionDays` is **forbidden**, not required.

| `onUninstall` | Meaning | `retentionDays` |
|---|---|---|
| `retain` | Held **indefinitely**. Removed only by an explicit authorized action. | **Forbidden** |
| `archive` | Held for a bounded period, then disposed of. | **Required** |
| `export` | Handed to the tenant. | Not applicable |
| `delete` | Destroyed on uninstall. | Not applicable |

The word already carried this meaning in English; the schema was contradicting it. An App
that wants a bounded hold declares `archive` and says how long. An App that must never lose
tenant data declares `retain` and says nothing further, because there is nothing further to
say.

`app-manifest.schema.json` changes its `allOf` conditional accordingly: `retentionDays` is
required when `onUninstall` is `archive`, and prohibited when it is `retain`.

## Why this is decided now rather than deferred

A manifest format change touches the SDK, Studio, `APP_STANDARD.md`, and every future
published manifest. That is exactly why the AZ7 precedent required a decision record, and
this is that record.

**It is cheap now and expensive later, and the gap between those is the whole argument.**
Nothing consumes this schema yet: there is no SDK, no Studio, no runtime, no installation
path, and no published manifest anywhere. The change is a conditional in one file. Once a
single third-party manifest exists, the same change becomes a breaking migration with a
deprecation window.

## Consequences

- **`apps/customers/manifest.json` becomes authorable truthfully** — `retain`, no
  `retentionDays`, matching the decided policy exactly.
- **Every existing manifest fixture must be re-checked.** Any fixture declaring `retain`
  with a `retentionDays` now fails validation, correctly.
- **The 30-day figure stays in the contract's `retention` block**, where it is true. It is
  a per-customer deletion recovery window and it is not a lifecycle property of the App.
  `customerDeletionRetentionDays = 30`.
- **`retain` gains a real guarantee.** A tenant reading the uninstall screen is told the
  data is kept, and nothing in the platform may later dispose of it on a timer.
- **This does not decide the purge mechanism.** The scheduler is a Core platform primitive;
  the predicate and the policy are App semantics. No customers table, no customer status
  and no retention constant enters `platform/core/**`.
- **`APP_STANDARD.md` §9 and the SDK must state the new meaning** when either is written.

## Approval

Decided by the Team Lead under authority the user delegated on 2026-09-01. The user decided
the *policy*; this record decides only how the manifest expresses it, after
`architecture-agent` established that it could not.

**Flagged for the user rather than assumed:** if `retain` should instead mean a bounded hold
with some default, this record is wrong and should be superseded before any manifest is
published. It is recorded now precisely because reversing it later is expensive.

Related: `0009` (the AZ7 precedent that a manifest-format change needs its own record);
`0007` (accepted permission model, which governs who may trigger the deletion this retention
window protects).
