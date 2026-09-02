# Customer Directory — implementation notes

The **implementation** of `packages/contracts/apps/customers/` contract version 1. The
contract is authored by `architecture-agent` and is not adjusted here; if a shape in this
directory disagrees with it, this directory is wrong.

- **Contract of record:** `packages/contracts/apps/customers/README.md` + the `.contract.yaml`
  + the `.schema.json`. All three are normative together.
- **Manifest:** `packages/contracts/apps/customers/manifest.json`. Already authored and
  ADR `0011`-compliant. **Not re-authored here.**
- **In scope:** eight Actions. **Contracted and deliberately not built:** `DeleteCustomer`,
  `RestoreDeletedCustomer`, and the purge job (contract §11.1).

## Layout

| Path | What it holds |
|---|---|
| `domain/` | The entity, the state machine, normalisation, search semantics, the field rules. No storage, no HTTP, no Cloudflare. |
| `data/` | The column names, the migration, and **every** storage call this App makes. |
| `actions/` | The eight Action definitions and their handlers. |
| `api/` | The route table. Ten routes: eight executable, two deferred. |
| `app.ts` | The App's declared permissions and its router. |

## The five rules this App is built to

**1. It never sees a tenant identifier.** `ActionContext` carries no organization id, the
storage handle is bound to one tenant before the App receives it, `tenant_id` is not a
column this App knows, and the storage boundary refuses any spec that names it. So no code
here can write a tenant predicate — correctly, incorrectly, or at all — and none can put a
tenant identifier into a response, a log, an error or a cursor. The predicate is applied
centrally in `platform/core/storage/adapters/sql/sql-compiler.ts`.

**2. `business_id` is an authorization scope, never a boundary.** Every collection narrows
by the caller's authorized business set *in addition to* the tenant predicate. A business
predicate is never a substitute: Business identifiers are unique platform-wide, so a query
carrying only `business_id` does not fail and does not return empty — it returns another
Organization's customer.

**3. The evaluation order is the contract's, and it lives in Core.** Authenticate → derive
tenant and authorized business set → authorize without reference to any record → validate →
resolve within the tenant → authorize the row's Business → check state → operate, commit and
audit as one transaction. Steps 5 and 5b are `actions/common.ts`; the rest is
`platform/core/action/pipeline.ts`. A handler cannot skip or reorder them, and cannot commit
anything itself.

**4. `not_found` and `forbidden` are not interchangeable.** Cross-tenant is `not_found`,
byte-identical to a nonexistent identifier apart from `request_id` — guaranteed by
`notFound()` taking no arguments. Wrong Business inside the *right* Organization is
`forbidden`. That asymmetry is reasoned in contract README.md §3.2 and is the one
record-dependent authorization decision in the App.

**5. Mutations are audited; reads are not.** A documented, time-bounded exception to
`AUTHORIZATION_STANDARD.md` §6 (CD-1), with an accepted risk stated in full: a principal
holding only `customers.customer.list` can page the whole Organization untraced. Audit
records carry identifiers and decisions and **never field values**.

## Storage access

Every call is in `data/customer-repository.ts`. There are five, and the contract's
per-query-path coverage obligation applies to exactly these:

| Function | Query paths |
|---|---|
| `findById` | detail read; the read half of update, archive, restore and move |
| `findDisplayNameKey` | cursor continuation read |
| `page` | list read, search read |
| `insertOperation` | create write |
| `updateOperation` | update, archive, restore and move writes |

Plus the audit write, which is Core's.

## Search, in one paragraph

Normalise (NFC → lowercase → trim → collapse whitespace), then: every query term must be a
prefix of some token of the name (AND across terms), **or** the whole query is a prefix of
the email, **or** the query's digits are a suffix of the phone's digits — that last rule only
above four digits. `notes` and `address` are never matched. `%` and `_` are literal. No
accent folding (CD-6), so `Muller` does not match `Müller`.

Three stored key columns make it index-shaped: `display_name_key` (space-prefixed, which
turns "prefix of a token" into a `contains` and doubles as the sort key), `email_key`, and
`phone_key` (digits **reversed**, so a suffix match is a prefix match). They cost roughly 60
bytes per typical row beyond the contract's storage projection — see `data/schema.ts`.

## What this App cannot do yet, and why

| Blocked on | Effect |
|---|---|
| **AZ2** — no authentication mechanism is recorded | Every request is `unauthenticated`. A deny-all resolver is wired deliberately; a permissive default would be an authentication bypass. |
| **TenantDirectoryEntry** — not built | Every Organization fails closed at the resolver. |
| **Core organization structure** — no `business` table | `CreateCustomer` and `MoveCustomerToBusiness` cannot validate a destination Business. |
| **TS1 / CF5** — no test framework, no migration runner | The migrations are reviewed definitions, unapplied. Tests are `qa-agent`'s. |

None of these is repaired here. Each needs a decision this App may not make.
