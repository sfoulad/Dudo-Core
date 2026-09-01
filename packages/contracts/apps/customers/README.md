# Customer Directory — contract of record, v1

- **Status:** **Proposed.** Authored by `architecture-agent`; the Team Lead reviews and
  agrees it. Not accepted, not built. No consumer implements against it until it is agreed
  (`.claude/rules/workflow.md` §3). `architecture-agent` does not accept its own contracts,
  and applying two user decisions does not make this revision accepted — the status is
  unchanged.
- **Revised:** 2026-09-01, for the CD-8 (retention) and CD-2 (business scope) user decisions
  and the CD-1 (read auditing) Team Lead ruling. **2026-09-02:** permissions registered, ADR
  `0011` applied, and the CD-13 ruling that `DeleteCustomer` and `RestoreDeletedCustomer` are
  contracted but **out of scope for the MVP implementation** (§11.1). See §0.
- **App id:** `customers` · **Contract version:** 1 · **Public API version:** `v1`
- **Artifacts, all three normative together:**
  - `customer-directory-v1.schema.json` — every request and response shape
  - `customer-directory-v1.contract.yaml` — the Action definitions, permissions, tenancy,
    audit, HTTP binding, free-tier impact
  - this file — the reasoning, the state machine, the search semantics, and every question
    that had to be decided rather than answered
- **Depends on:** `API_STANDARD.md`, `AUTHORIZATION_STANDARD.md`, `MULTITENANCY_STANDARD.md`,
  `SECURITY_STANDARD.md`, `EVENT_STANDARD.md`, `APP_STANDARD.md`, `CORE_BOUNDARIES.md`,
  `docs/decisions/0006` (Accepted), `docs/decisions/0007` (Accepted),
  `docs/decisions/0011` (Accepted — `retain` means indefinite; `retentionDays` forbidden
  under it), `docs/decisions/0012` (Accepted — `apis[].path` permits `snake_case`
  parameters).

A type alone is not a contract. What follows is the rest of it.

---

## 0. What changed on 2026-09-01

Two user decisions relayed by the Team Lead, and one Team Lead ruling, are applied here in
full. They are recorded at the top because they change the shape of the entity and the reach
of every permission, and because a reader who knows only the previous revision would
otherwise read four sections before discovering it.

**CD-8 — retention. Decided.** Archived customers are retained **indefinitely**; archive is
not a countdown to deletion. Permanent deletion is explicit and authorized, has a **30-day
recovery window**, and then purges the customer's personal data. Audit keeps identifiers
and action metadata, never the deleted personal details. **No automatic purge may ever
remove an active or merely archived customer.** Consequence: three new Actions, three new
permissions — including `customers.customer.delete`, which the previous revision
deliberately withheld so that nobody could hold it — and a new `pending_deletion` state.

**CD-2 — scope. Decided.** `Customer` gains a **required `business_id`**. `organization_id`
remains the tenant-isolation boundary; `business_id` controls access *inside* the
Organization and is **not** a second tenant boundary. The six original permissions widen to
`[organization, business]`, the three new ones stay `[organization]`, and moving a customer
between Businesses is its own audited Action rather than a field on `UpdateCustomer`.

**CD-1 — read auditing. Ruled on by the Team Lead.** Reads stay unaudited, as a
**documented, time-bounded exception** to `AUTHORIZATION_STANDARD.md` §6 — and **the
standard is not edited to agree**. The deletion path is audited without exception, and the
purge audit record is written **before** the personal data is destroyed. The enumeration gap
— a `list`-only principal can page the whole Organization untraced — is an **accepted risk**
on the user's explicit instruction, not an omission, with a named future obligation:
coarse-grained enumeration auditing, not per-read auditing. §10.1.

**CD-13 — deletion scope. Ruled on by the Team Lead, 2026-09-02.** All nine permissions are
now **registered**, so the registration blocker is gone. `DeleteCustomer` and
`RestoreDeletedCustomer` remain unreachable for a different and still-live reason — `delete`
is `critical` and the platform confirmation mechanism does not exist — and that is ruled
**acceptable, not a blocker**: both are **contracted but out of scope for the MVP
implementation**, along with the purge job. **§11.1** is binding and should be read before
implementing anything.

**The manifest problem CD-8 exposed is now closed too, by ADR `0011`.** The App manifest's
`lifecycle.retentionDays` could not express the decided model — it means "how long tenant
data is held **after uninstall**", and the decided 30 is "how long an explicit deletion of
**one customer** can be undone". `architecture-agent` refused to write `30` into it and
reported the defect; `docs/decisions/0011-manifest-lifecycle-indefinite-retention.md`
(**Accepted**, 2026-09-01) resolved it by redefining `onUninstall: retain` to mean
**indefinite**, with `retentionDays` **forbidden** under it. This App therefore declares
`retain` and no `retentionDays` at all, and `apps/customers/manifest.json` is authorable
truthfully. §10 "CD-8 in full" keeps the reasoning as the record of why `0011` exists.

---

## 1. What this feature is

A directory of the people and companies an Organization does business with, filed under the
Business that serves them. Ten operations are **contracted**: create · list · search · view ·
edit · archive · restore · move · delete · cancel deletion.

**Eight are built in this slice.** `delete` and `cancel deletion` are contracted but
deliberately not built — see **§11.1**, which is binding and which an implementing agent
should read before anything else here.

**Explicitly out of scope, and no hook is left for any of it:** invoicing, payments,
accounting, leads, sales pipelines, automation. There is no `balance`, no `owner`, no
`stage`, no `tags`, no `custom_fields`, and no extension point that anticipates one. A
field added "for later" is a field two clients must render, QA must isolate, and a
migration must carry.

`business_id` and the deletion Actions are not exceptions to that rule. Neither was added
in anticipation of a need: both implement a decision the user made, and both were declined
in the previous revision precisely because no decision existed.

---

## 2. This is an App, not Core — and that is not a judgement call

`CORE_BOUNDARIES.md` §5 names it directly:

> | Customers, contacts, leads | An App | Industry nouns. Fails inclusion test §2.3. |

The four-question inclusion test (§2), answered for the record:

| # | Question | Answer |
|---|---|---|
| 1 | Would every App need it, in every industry, in the same shape? | **No.** A freight company's customer and a SaaS startup's customer differ in nearly every field beyond a name. |
| 2 | Does the platform stop working without it? | **No.** Identity, authorization and tenancy are load-bearing. A customer record is not. |
| 3 | Is it free of business semantics? | **No.** "Customer" is an industry noun. |
| 4 | Would putting it in an App make the App unbuildable? | **No.** An App can hold this entirely, through published contracts. |

Four "no"s. It is an App. `platform/core/**` gains nothing from this slice, and a request
to put a `customers` table in Core should be refused and escalated.

**One boundary finding follows from this and is reported to the Team Lead rather than
fixed here:** `core-object-registry.yaml` declares a UI extension location
`Customer.Profile.Tab`, which is an industry noun in a Core-owned registry —
`CORE_BOUNDARIES.md` §6.1. It also implies a customer profile page exists for other Apps to
extend, and this App is what provides it. That is a coupling between Core's location list
and one App, and it is Core's to resolve, not this contract's.

**A second boundary finding arrives with this revision, and it does not change the answer
above.** The CD-8 decision requires a scheduled purge (§6.1). The *scheduler* — a
tenant-iterating execution path with a per-tenant storage handle — is a platform primitive
that every App with retained data will eventually need, in the same shape, so it passes
`CORE_BOUNDARIES.md` §2 and belongs to Core. The *predicate and the policy* — what
`pending_deletion` means, what 30 days means, which rows qualify — are business semantics
and stay in this App. **No `customers` table, no customer status and no retention constant
enters `platform/core/**`.** If an implementation proposes putting the purge query in Core
because that is where the scheduler is, that is the boundary being crossed by convenience
and it should be refused and escalated.

---

## 3. Tenant scoping

Full rules in `customer-directory-v1.contract.yaml` under `tenancy`. The three that decide
everything else:

1. **Tenant = Organization.** A Customer belongs to an Organization and, within it, to a
   Business. `MULTITENANCY_STANDARD.md` §2 says Businesses inside an Organization routinely
   need to share customers — which is precisely why Business is an authorization scope and
   not an isolation boundary. Sharing across Businesses is what a *grant* regulates; it is
   never something a boundary has to be crossed to do.
2. **Tenant identity comes from the authenticated server-side context, on every call.** No
   Action here has a tenant parameter and none may be added. Nothing in a body, header,
   query string, cursor or SDK argument selects a tenant, and an attempt is rejected rather
   than merged or preferred.
3. **There is no infrastructure boundary underneath this contract.** Under `0006`
   Option A every Organization's customers sit in one shared D1 database. A query missing
   its tenant predicate does not fail and does not return empty — it returns another
   Organization's customer. The predicate is therefore applied centrally by the Core-owned
   storage boundary, whose handle comes from `TenantStoreResolver`, and never written by
   hand in a query.

**The Customer entity has no `tenant_id` on the wire.** It is never accepted on input — it
is not a property of any input schema and `additionalProperties` is `false`, so supplying
one fails the request — and it is never returned. No client ever learns a tenant identifier
it might be tempted to send back.

### 3.1 `business_id` is on the wire, and `organization_id` is not

The asymmetry is deliberate and it is the single most important thing to get right in this
revision.

| | `organization_id` | `business_id` |
|---|---|---|
| What it is | The **isolation** boundary | An **authorization** scope inside it |
| On the wire | **Never** — not in, not out | Required on create, returned on every response, optional as a list/search filter |
| Where it comes from | Derived from the authenticated context, always | The principal's **authorized business set** is derived from context; a supplied value **selects within** that set and can never widen it |
| Order of evaluation | **First**, centrally, at the storage boundary | **Second**, on rows already proved to be in the tenant |
| Failure answer | `not_found`, byte-identical | `forbidden` (§3.2) |

**The two-level check is Organization, then Business, and the second never stands in for
the first.** A query that carries `business_id` and has lost `organization_id` crosses
tenants: Business identifiers are unique platform-wide, so such a query does not fail and
does not return empty — it returns another Organization's customer, exactly as a query
missing the tenant predicate always would. Uniqueness prevents collision; it has never
prevented reachability. A business predicate is an **additional narrowing, never a
substitute**, and any code path, index, cursor or cache key that treats `business_id` as
sufficient identification is a critical defect.

Why `business_id` may be returned when `tenant_id` may not: the worst case for a wrong
`business_id` is bounded inside one Organization's own data, and the client genuinely needs
it — a merged directory row that does not say which Business it belongs to is a row that
will be acted on in the wrong one. The worst case for a `tenant_id` on the wire is a client
that has learned an identifier it may one day send back.

### 3.2 Wrong Business inside the right Organization: `forbidden`, not `not_found`

**Ruling: `forbidden`.** A customer that exists in the authenticated Organization, in a
Business the principal is not authorized over, returns `forbidden`. Cross-tenant stays
`not_found` and byte-identical, and nothing below weakens that.

This is the one place the tenant rule should *not* be copied downward by reflex, so the
reasoning is set out rather than asserted:

- **The justification for `not_found` does not reach here.** It exists to stop one company
  learning a fact about *another company's* data. Inside one Organization there is no
  second party: the Organization owns every one of these records and is the party in a
  data-protection complaint about them. Neither `API_STANDARD.md` §8 nor
  `MULTITENANCY_STANDARD.md` §5 requires `not_found` intra-tenant; both scope the
  requirement to the tenant boundary.
- **The operational argument decides it, and it runs the opposite way from habit.** Told
  `not_found`, a business-admin concludes the customer is not in the system and has staff
  re-enter it — producing a duplicate customer inside the same Organization, in a different
  Business, with a divergent address, a divergent phone number and its own future invoices.
  This contract has **no duplicate detection** (CD-4), so nothing catches it. That is
  silent corruption of the tenant's own directory, caused by the platform lying to it about
  its own data. Told `forbidden`, the same person asks for access or for a move — which is
  what `MoveCustomerToBusiness` exists for.
- **The residual risk, stated.** A principal inside Organization A holding a `customer_id`
  it should not have learns that the record exists somewhere in Organization A. It learns
  nothing else: the response carries no field, no name, and **not the record's actual
  `business_id`**. And it cannot enumerate — `customer_id` is opaque, non-sequential and
  unguessable (§5), so an identifier can only have come from inside the tenant already.
- **The property this ruling could have broken, checked.** `forbidden` is returned *only*
  for rows already resolved inside the caller's own Organization. A foreign Organization's
  identifier, a purged customer's identifier and a fabricated string all terminate earlier,
  at the same `not_found`. So the caller cannot use the difference to distinguish "exists
  in another Organization" from "exists nowhere". The new answer partitions in-tenant from
  everything else — never one tenant from another.

Two consequences follow and are handled in the contract rather than left implicit:

- **This is the only record-dependent authorization decision in the contract.** The
  previous revision could say that `forbidden` never correlates with a record's existence;
  that is no longer true intra-tenant, and the evaluation order in
  `customer-directory-v1.contract.yaml` now says so at step 5b instead of claiming
  otherwise.
- **The denial is audited, and the audit record does not name the record's Business.**
  Telling the log which Business the caller was refused hands to a log reader the
  disclosure the refusal withheld.

**Collections never return `forbidden` for a row.** A listing or search filters out
Businesses the caller is not authorized over — no count, no placeholder, no gap in the
cursor. `forbidden` on a collection appears only when the caller *explicitly names* a
`business_id` it is not authorized over, because there the caller asserted a scope and
deserves a straight answer.

---

## 4. Field classifications

Every field is classified, because classification drives logging, export, audit and
AI-provider rules (`SECURITY_STANDARD.md` §3), and an entity definition that does not
classify its fields is incomplete.

| Field | Type | Required | Classification |
|---|---|---|---|
| `customer_id` | opaque string | server-set | internal |
| `business_id` | opaque string | **yes**, on create | internal |
| `display_name` | string ≤ 200 | **yes** | business-confidential |
| `customer_type` | `person` \| `company` | **yes** | business-confidential |
| `email` | string ≤ 254 | no | **sensitive-personal** |
| `phone` | string ≤ 32 | no | **sensitive-personal** |
| `country` | ISO 3166-1 alpha-2 | no | business-confidential |
| `address` | free text ≤ 500 | no | **sensitive-personal** |
| `notes` | free text ≤ 2000 | no | **sensitive-personal** |
| `status` | `active` \| `archived` \| `pending_deletion` | server-set | internal |
| `deletion_scheduled_at` | RFC 3339 UTC, nullable | server-set | internal |
| `created_at` · `updated_at` | RFC 3339 UTC | server-set | internal |
| `created_by_principal_id` · `updated_by_principal_id` | opaque string | server-set | internal |

Three classification decisions are worth stating because they are not obvious:

- **`business_id` is `internal`, not business-confidential.** It is an opaque identifier of
  the caller's own Organization's structure, carrying no name and no content, and it is
  returned only to principals already authorized to see the record. It is **not** an
  ownership relation either: it names a Business, not a principal, so it can never be
  borrowed to satisfy `own` scope (`AUTHORIZATION_STANDARD.md` §4, VAL-OWN).

- **`email` and `phone` are sensitive-personal even though a company customer's are not
  personal data.** A field is classified at the highest class it *can* hold, not the class
  it is expected to hold. `customer_type` is data, not a guarantee, and a classification
  that depends on another field's value is a classification nothing can enforce.
- **`notes` is sensitive-personal because it is free text.** Staff will type whatever they
  need to remember. A field cannot be classified by hope.

**Consequence, flagged.** `SECURITY_STANDARD.md` §3 says sensitive-personal requires
"explicit permission, plus audit on read where the tenant requires it." Read-audit is a
tenant policy toggle that does not exist in this slice and is deliberately not built —
see open question **CD-1**.

**No field is classified `secret`,** and none may be. `financial-instrument` does not
appear either: this slice records no bank details, no IBAN and no card data, which is what
keeps it out of PCI scope entirely (`SECURITY_STANDARD.md` SE3).

---

## 5. Identifiers

`customer_id` is opaque, non-sequential and unguessable. The client never parses it, never
orders by it, and never infers anything from it. The generation scheme is a Core decision
and is not fixed here; the 8-character minimum exists so a short, enumerable scheme cannot
be adopted without anyone noticing.

**Identifiers are unique platform-wide, not merely per Organization, and that does not
weaken isolation.** Uniqueness prevents an identifier from *colliding* across tenants; it
does nothing to make one *reachable*. Reachability is decided entirely by the tenant
predicate. Per-tenant sequential identifiers would be worse on both counts: enumerable, and
a collision across tenants would be a silent correctness bug in every cache and log.

---

## 6. The lifecycle state machine

```
                    CreateCustomer
                          │
                          v
      ┌───────────────► active ───────────────┐
      │                    │                  │
      │           ArchiveCustomer     UpdateCustomer (stays active)
      │                    │
 RestoreCustomer           v
      │                 archived  ◄──────────────┐
      └────────────────────┘                    │
                           │                    │
                    DeleteCustomer      RestoreDeletedCustomer
                           │             (within 30 days)
                           v                    │
                    pending_deletion ───────────┘
                           │
                  30 days elapse — platform purge
                           │
                           v
                    (row deleted; audit retains customer_id only)
```

Normative:

| From | Action | To | Otherwise |
|---|---|---|---|
| — | `CreateCustomer` | `active` | status is never accepted on create |
| `active` | `ArchiveCustomer` | `archived` | any other state → `failed_precondition` |
| `archived` | `RestoreCustomer` | `active` | any other state → `failed_precondition`, **including `pending_deletion`** |
| `active` | `UpdateCustomer` | `active` | `archived` or `pending_deletion` → `failed_precondition` |
| `archived` | `DeleteCustomer` | `pending_deletion` | any other state → `failed_precondition` |
| `pending_deletion` | `RestoreDeletedCustomer` | `archived` | any other state → `failed_precondition`; after purge → `not_found` |
| `pending_deletion` | 30 days elapse | purged | nothing else reaches purged |
| `active`, `archived` | `MoveCustomerToBusiness` | unchanged | `pending_deletion` → `failed_precondition` |
| any | `GetCustomer` | unchanged | archived and pending-deletion records remain readable by identifier |

- **Archive is not delete, and it starts no clock.** An archived customer is retained
  **indefinitely**. No elapsed time, no quota, no inactivity and no background job moves a
  record out of `archived`. This is the decision's central point, and it is what the
  `retentionDays` finding in §10 CD-8 protected — and what ADR `0011` now guarantees
  structurally, by making `onUninstall: retain` mean indefinite and forbidding a duration
  under it.
- **Deletion is reachable only from `archived`.** Deleting an active customer is
  `failed_precondition`, not a silent archive-then-delete. Deletion is then a deliberate
  two-step act by someone who has already withdrawn the record from use, and a mis-click on
  a live customer cannot start a destruction clock. **This is an interpretation** — the
  decision fixed the policy, not the entry state — and the alternative is recorded as
  **CD-12** rather than assumed wrong.
- **Cancelling a deletion returns the record to `archived`, not to `active`.** Otherwise one
  recovery would perform two reinstatements, putting a customer back into every list and
  search the Organization can see without anyone holding `customers.customer.restore`.
- **`RestoreCustomer` refuses `pending_deletion`, and that is not an inconsistency.** It is
  a business-scope permission; countermanding an organization-level destruction order is
  `customers.customer.restore-deleted` at organization scope. Letting the tidy-up permission
  do it would be a scope escalation wearing a familiar name.
- **After the purge, the identifier returns `not_found`** — the same `not_found` as a
  foreign-Organization identifier and as one that never existed, byte for byte. A distinct
  "already purged" answer would turn every purged customer into a permanent, queryable
  record of the fact that the Organization once held one, which is the opposite of what a
  purge is for.
- **An archived or pending-deletion customer cannot be edited.** Restore first. A record
  withdrawn from use that can still be quietly changed is neither withdrawn nor a record —
  and during a recovery window, what an authorized principal would restore must be what it
  chose to keep.
- **Moving an archived customer is allowed; moving a pending-deletion one is not.**
  Reorganising the Organization's own structure should not be blocked by a record being
  withdrawn from use, and an archived customer in a Business that no longer serves it is
  exactly the record someone will need to move. A record under a destruction order is
  different: its Business is part of what the recovery restores.
- **Transitions are strict, not idempotent.** Archiving an already-archived customer is
  `failed_precondition`. The trade is real and is accepted deliberately: a retried archive
  after a network failure returns an error the client must treat as success, but the
  permissive alternative writes an audit record saying a customer was archived when nothing
  changed. An audit trail that records operations which did not happen is worse than one
  that is occasionally awkward to retry against.
- **There is no `archived_at` or `archived_by` field.** `updated_at` and
  `updated_by_principal_id` carry it, and the audit record carries the rest. Adding
  dedicated fields would be inventing beyond the agreed field set.
- **`deletion_scheduled_at` is the one exception, and it earns it.** The deadline *is*
  derivable as `updated_at` + 30 days, so by the rule above it should not exist. It exists
  because it is a legally meaningful date that both clients display, and making each client
  compute it from a constant is exactly the cross-client divergence the one-contract rule
  prevents: the day the window changes, the web app and the iPhone app show two different
  dates for when a customer's data is destroyed. It is non-null **if and only if** status is
  `pending_deletion`, and null in every other state including `archived` — an archived
  record has no scheduled deletion, and a field implying otherwise would restate the
  countdown the decision removed.

### 6.1 The purge

The purge is the platform's, not a user's, and its predicate is the whole of it:

> tenant scope, **AND** `status = 'pending_deletion'`, **AND** `deletion_scheduled_at <= now`

- **No automatic purge may ever remove an active or merely archived customer.** The
  predicate has no other form and never falls back to a date comparison alone. This is a
  mandatory test obligation (§12), not a code comment.
- **It runs per tenant, or iterates tenants one at a time** (`MULTITENANCY_STANDARD.md` §4,
  carrier 6). A purge that queries every Organization's rows in one statement is a
  cross-tenant read; one whose predicate is wrong is a cross-tenant **delete**, the most
  destructive form the failure can take, and under `0006` Option A there is no
  infrastructure boundary to catch it.
- **Purge means the row is deleted in full** — `display_name`, `email`, `phone`, `country`,
  `address`, `notes`, all of it. Erasing only the fields classified sensitive-personal and
  keeping a husk would leave business-confidential data behind under the name of a purge.
- **Each purge writes an audit record** in the purged customer's own Organization: platform
  principal, `customer_id`, the deletion request it completes, the time. A destruction
  nobody recorded is indistinguishable afterwards from data that was never there.
- **The purge audit record is written *before* the personal data is destroyed.** This
  inverts the normal order — operate, commit, then audit — and the inversion applies to the
  purge alone. After a purge there is nothing left to reconstruct the record from, so the
  audit line is the only remaining evidence the customer ever existed; a purge that destroys
  the data and then fails to write it leaves no trace of itself at all.
  **Order the failure modes rather than hoping neither happens:**

  | Order | Failure looks like | Recoverable? |
  |---|---|---|
  | Audit, then delete | An audit record for a purge that did not complete. The row still exists, the predicate still matches, the job retries. | **Yes** — visible and reconcilable |
  | Delete, then audit | Data destroyed with no record of it. | **No** — invisible, and nothing survives to reconstruct it from |

  The first is a discrepancy; the second is a hole.
- **Where the storage boundary can make the audit write and the row deletion atomic, it
  must** — one transaction removes the ordering question entirely. Where it cannot, the
  order above is mandatory, and the cost is stated rather than hidden: a retry after a
  committed audit and a failed delete writes a **second** audit record for the same
  `customer_id`. Duplicate purge lines are acceptable and expected — append-only means they
  are never edited away — and a missing line is not.
- **The audit trail survives the purge and needs no scrubbing to do so.** Audit records
  already carry identifiers and decisions and never field values, so a purged customer's
  audit history contains no personal data and nothing has to reach into an append-only log
  to erase anything. That is what makes "audit may keep the customer ID, not the deleted
  personal details" satisfiable at the same time as "never updated, never deleted" — and it
  is a standing obligation: any future change that puts a field *value* into an audit
  record creates a copy of the personal data the purge cannot reach.
- **The mechanism is Core's to design.** This contract states the obligation and the
  predicate, not the scheduler.

---

## 7. Search semantics

"Search" without matching semantics is not a contract, so here they are, normatively.

### 7.1 Searchable fields

**`display_name`, `email`, `phone`. Nothing else.**

**`notes` and `address` are deliberately not searchable.** Both reasons matter:

- **Disclosure.** `notes` is free text a member of staff wrote for themselves. Making it
  searchable turns an arbitrary phrase into a probe that confirms whether that phrase
  appears in someone's record — a targeted disclosure over the most sensitive field in the
  entity, available to anyone holding only `list`, which is the permission that
  deliberately does *not* return `notes` at all. Making it searchable would hand back
  through the search box what the list projection withholds.
- **Cost.** They are the two largest fields, and an unanchored scan over them runs on a
  single-threaded shared D1 where one Organization's heavy query is every Organization's
  latency.

Adding a searchable field later changes which records a given query returns. It is not a
schema change, but it *is* a behaviour change a client may depend on, so it carries a
contract-version note and Team Lead review — it is not a patch.

### 7.2 Normalisation

Applied identically to the query and to the stored value before matching:

1. Unicode NFC.
2. Simple case folding (locale-independent lowercasing).
3. Leading and trailing whitespace trimmed; internal whitespace runs collapsed to one
   space.

**No accent folding and no transliteration.** `Muller` does **not** match `Müller`, and
`Mohammed` does not match `Muhammad`. This is a real limitation for Arabic-, French- and
German-language directories and it is stated rather than implied, because it requires a
collation decision no ADR covers — open question **CD-6**.

### 7.3 Matching

A customer matches if **any** of the three field rules matches (OR across fields):

| Field | Rule |
|---|---|
| `display_name` | The normalised query is split on whitespace into terms. The customer matches if **every** term is a **prefix** of at least one whitespace-delimited token of the normalised `display_name`. AND across terms. So `an sm` matches `Anna Smith`; `smith an` also matches it; `nna` matches nothing. |
| `email` | The normalised query is a **prefix** of the normalised `email`. |
| `phone` | Both the query and the stored value are reduced to their digit sequence, with every non-digit removed. The customer matches if the reduced query is a **suffix** of the reduced stored value. This rule participates **only** when the reduced query has **at least 4 digits**; below that the field is skipped. |

Why each:

- **Prefix, not substring, for names and email.** Prefix is what a person typing a name
  expects, it is bounded, and it is the form an index can serve if one is ever added. An
  unanchored substring match is a full scan of every row on a single-threaded shared
  database, for every keystroke, for every Organization at once.
- **Suffix for phone**, because people search by the last digits they remember and the
  country prefix is exactly the part that varies. **Implementation obligation, stated
  here because it is a free-tier obligation, not a preference:** a suffix match is not
  servable by an ordinary prefix index, so the storage design must either keep a
  reversed-digit column or bound the scan. An unbounded scan of every customer row per
  keystroke is the noisy-neighbour failure `MULTITENANCY_STANDARD.md` §7.7 warns about.
- **The 4-digit floor** stops `12` from matching most of a directory and charging a scan
  to say so.

### 7.4 What search is not

- **No wildcards.** `%` and `_` are literal characters. No glob and no regular expression
  syntax is honoured. A caller cannot inject a matching pattern.
- **No relevance ranking and no score.** Results are ordered by §8's fixed order. An
  undefined order makes cursor pagination unstable and makes the two clients disagree about
  the same result set.
- **No search index.** This is a storage-level match. `SearchIndexEntry` in the Core object
  registry is blocked — no search engine is approved (`MULTITENANCY_STANDARD.md` MT5) — and
  this contract deliberately does not depend on one.
- **Not tenant-blind.** Search is scoped by the same storage boundary as everything else. A
  search returning zero results in Organization A must be indistinguishable from a search
  whose every match lives in Organization B.

### 7.5 Status and Business bounding

Search defaults to `status = active`, exactly as listing does, and takes the same explicit
`status` parameter — now including `pending_deletion`, which is filterable under
`customers.customer.list`. A record scheduled for destruction that nobody can find is a
record nobody will recover in time; the 30-day window is only real if the queue is visible.
Enumerating it is the same disclosure as enumerating the rest of the directory, so it takes
the same permission. Ordering and reversing the deletion still take
`customers.customer.delete` and `customers.customer.restore-deleted`.

Search is bounded by the caller's authorized Businesses exactly as listing is, and **the
bound is applied to the candidate set before matching, never to the results after it.** A
search that matched across Businesses the caller cannot list and then filtered the output
would still leak through page counts and cursor behaviour — the same failure the exclusion
of `notes` exists to prevent, one scope level up.

---

## 8. Listing, ordering and pagination

- **Order is fixed and total:** normalised `display_name` ascending by Unicode code point,
  then `customer_id` ascending as the tiebreaker. No sort parameter exists in v1. A total
  order is what makes a cursor correct; ordering on a non-unique field alone silently
  duplicates and skips rows across pages.
  **Code-point order is not locale-correct** for Arabic or for accented Latin scripts —
  same root cause as §7.2, same open question **CD-6**.
- **Cursor pagination only.** Default page size 25, maximum 100. Both documented, as
  `API_STANDARD.md` §7 requires.
- **Omitting `business_id` does not mean "the whole Organization".** It means every Business
  the caller is authorized over — which for a business-scope principal is exactly one. The
  listing is never wider than the caller's authorization, so the default is safe for the
  narrowest principal and useful for the broadest: a business-owner gets one merged
  directory, a business-admin gets their own Business, and neither had to know which case
  they were in. The ordering above is *global* across the returned Businesses, not grouped
  by Business, which is why `business_id` is on every row.
- **The cursor records `business_id` alongside `status` and `page_size`**, and a mismatch is
  rejected exactly as those are. A cursor is not permitted to be the thing that decides
  which Businesses a page covers.
- **The maximum page size is a disclosure control, not only a performance one.** It is what
  stops a `list` permission from being an undeclared bulk export in one call — and `export`
  is a separate permission this slice deliberately does not declare.
- **The cursor never carries the tenant predicate.** It records the tenant it was issued
  for so that the mismatch can be *rejected*; the predicate itself always comes from the
  authenticated context. An input that decides its own scope is not an input, it is a
  grant.
- **Malformed, expired, forged, wrong-tenant and wrong-filter cursors all return the same
  `invalid_argument`,** with the same message and the same detail token. Distinguishing
  them tells a caller which of its guesses was closer, and the wrong-tenant case is the one
  that would leak.
- **No total count.** Reason and consequence in
  `../../common/pagination.schema.json`. The product consequence is concrete: **neither
  client can show "247 customers".** That is a real loss and it is the correct trade —
  a pagination total is an aggregate, `TESTING_STANDARD.md` §5.2 puts aggregates in scope of
  "infer", and a cross-tenant total is the cheapest leak to write by accident under
  `0006` Option A because it returns no records at all.

---

## 9. HTTP paths — a decision that is cheap now and breaking later

Routes are bound under `/api/v1/apps/customers/...`
(`customer-directory-v1.contract.yaml` → `httpBinding`). That is valid by construction and
requires no allocation, because `customers` is **not** an allocated segment in
`core-object-registry.yaml`'s `reservedApiPathSegments`.

The alternative is for the Team Lead to allocate the flat segment `customers` to this
official App, giving `/api/v1/customers/...`.

**The timing is the finding.** Choosing before either client is written costs nothing.
Changing afterwards is a breaking change under `API_STANDARD.md` §6 requiring `/api/v2` or
a deprecation window with `Deprecation` and `Sunset` headers — for a cosmetic path.
Open question **CD-7**.

---

## 10. Open questions — decided-around, not buried

Each was worked around to produce this contract. The assumption made is stated in every
case.

| # | Question | What was assumed here | Who decides |
|---|---|---|---|
| **CD-1** | ~~Read auditing conflicts with `AUTHORIZATION_STANDARD.md` §6.~~ **RULED ON by the Team Lead, 2026-09-01.** | **Decided: reads stay unaudited**, as a documented, time-bounded exception to §6 — **the standard is not edited to match**. The deletion path is audited without exception, and the purge audit record is written *before* the data is destroyed. The enumeration gap is an **accepted risk**, not an omission. Full statement in **§10.1** below. | **Closed** |
| **CD-2** | ~~No business-scope role can hold any customer permission.~~ **RESOLVED by the user, 2026-09-01.** | **Decided:** `Customer` carries a required `business_id`; `organization_id` remains the sole tenant boundary. The six original permissions are `[organization, business]`, the three new ones `[organization]`, and the six Actions are **evaluated at `scope: business`** so that a business-scope grant can actually satisfy them. `business-admin` and `member` are now *eligible* — eligibility, not a grant: nothing is granted until the Team Lead registers the permissions and decides role membership. See §3.1, §3.2. | **Closed** |
| **CD-3** | **No optimistic-concurrency token.** Two staff editing one customer at once: last write wins, silently. | Not added — it is outside the agreed field set. The contract is shaped so adding an optional `version` request field plus a `version` response field later is **additive**; making it required is breaking. | Team Lead |
| **CD-4** | **`CreateCustomer` is `idempotent: false`**, so an `Idempotency-Key` is accepted but not required, and no duplicate detection exists on `display_name` or `email`. A retried create after a network failure produces a second customer. | Accepted. The worst outcome is a duplicate row, not duplicated money or a duplicated message, which is the class `API_STANDARD.md` §9 makes mandatory. | Team Lead |
| **CD-5** | **What a failed cross-tenant lookup may record in the caller's audit trail.** `az7-r3` requires the attempt be audited in the caller's tenant *and* that nothing of the other tenant be disclosed to it. | The caller-supplied identifier is recorded, marked unresolved, plus nothing derived from any record. Reading: echoing back a value the caller authored teaches it nothing. The strict alternative — record no identifier — makes an enumeration run indistinguishable from noise, which defeats the reason for auditing it. | Team Lead, with Security |
| **CD-6** | **Collation.** Search does no accent folding and sorting is by Unicode code point, so `Müller` does not match `Muller` and Arabic names do not sort as a reader expects. | Stated as a limitation, not hidden. Fixing it needs a collation decision no ADR covers, and it changes both search results and sort order — breaking under `API_STANDARD.md` §6. | Team Lead / user |
| **CD-7** | **Flat API namespace allocation** (§9). | App-namespaced path assumed. **Decide before either client is written; breaking afterwards.** | Team Lead |
| **CD-8** | ~~Retention policy, and the manifest field that could not express it.~~ **CLOSED in both halves.** Policy: **resolved by the user**, 2026-09-01 (§0, §6, §6.1). Manifest expression: **resolved by ADR `0011`** (Accepted, 2026-09-01). | **Decided:** `customerDeletionRetentionDays = 30` lives in `customer-directory-v1.contract.yaml` → `retention`, where it is true — it is a per-customer deletion recovery window, not a lifecycle property of the App. The manifest declares `onUninstall: retain` and **no `retentionDays` field at all**, because `0011` redefined `retain` to mean indefinite and **forbids** `retentionDays` under it. See "CD-8 in full" below for why `0011` was needed. | **Closed** |
| **CD-9** | **AS1 — the executable form and transport of a Dudo contract is undecided**, and `API_STANDARD.md` AS1 says an ADR is needed *before the first contract is written*. | This contract follows the precedent already in `packages/contracts/` — JSON Schema draft 2020-12 plus YAML — rather than selecting a new form. **Nothing here is executed:** no JSON Schema implementation exists in this repository, so these schemas are hand-checked, not validated. Cross-file `urn:` `$ref`s need a resolver that does not exist. | Team Lead |
| **CD-10** | **A per-Organization customer quota is required** before external Organizations are admitted, so the 500 MB shared ceiling degrades to `quota_exceeded` rather than silently filling. | `quota_exceeded` is declared on `CreateCustomer` so the error path exists. **The number is not set here.** Recommendation: 10,000 per Organization. **Now sharper:** a purge mechanism exists, so the temptation to reach for it under storage pressure exists too. Running out of free storage is a reason to stop onboarding, never a reason to schedule a deletion nobody requested. | Team Lead / user |
| **CD-11** | **Where does a client-supplied `business_id` sit against "never trust a client-provided identifier"?** The decision says Core derives and validates *both* from context, and also that `business_id` is required on create — which cannot both be literally true unless "validates" means what is assumed here. | **Assumed:** a supplied `business_id` **selects within** the authorized business set derived from context; it can never widen it. Required on create rather than defaulted, because a principal may be authorized over several Businesses and inferring one from an "active Business" would be the ambient default `MULTITENANCY_STANDARD.md` §3 forbids one level up. There is no equivalent input for `organization_id` anywhere and none may be added. | Team Lead |
| **CD-12** | **Must a customer be archived before it can be deleted?** The decision fixed the retention policy, not the entry state. | **Assumed yes:** `DeleteCustomer` from `active` is `failed_precondition`. Deletion becomes a deliberate two-step act and a mis-click on a live customer cannot start a destruction clock. The alternative — deletion straight from `active` — is a one-line change to the state machine now and a **breaking** one once either client ships. | Team Lead / user |
| **CD-13** | **`DeleteCustomer` is `critical` and needs a platform confirmation mechanism that does not exist. RULED ON by the Team Lead, 2026-09-02.** | **Ruled: acceptable, and not a blocker for this slice.** `DeleteCustomer` and `RestoreDeletedCustomer` are **out of scope for the MVP implementation** — contracted, not built (**§11.1**). This is now the **only** thing holding them; the permission-registration blocker is gone. No confirmation field is invented in the request schema, and sensitivity is not downgraded to route around it. | **Closed for this slice**; the mechanism itself remains a Team Lead item |
| **CD-14** | **What happens to customers when a Business is deleted?** `Business` lifecycle is Core's, and a customer whose `business_id` names a Business that no longer exists is unreachable at business scope and orphaned at organization scope. | **Assumed:** Core must not permit deleting a Business that still has customers; `MoveCustomerToBusiness` is the mechanism for emptying it first. This contract provides the move and states the dependency; it cannot enforce a rule in Core's own lifecycle. | Team Lead, with Core |

---

### 10.1 CD-1 in full: unaudited reads, and the risk that is accepted rather than missed

Ruled on by the Team Lead, 2026-09-01. Three parts, all binding.

**1. Reads stay unaudited — and the standard is not edited to agree.**
`GetCustomer`, `ListCustomers` and `SearchCustomers` write no audit record.
`AUTHORIZATION_STANDARD.md` §6 says access to customer information maps to `sensitive` at
minimum, and `sensitive` requires an audit event; read literally, that would audit every
read. **The standard stands as written.** This contract takes a documented, time-bounded
exception to it, bounded by the MVP slice, extending to no other App, Action or entity by
precedent. Editing the standard to make the conflict disappear would be the inverse of
honest documentation: a document quietly amended to agree with an implementation has stopped
being a standard and become a description of what was built. The exception is recorded in
the artifact taking it — here, and in `customer-directory-v1.contract.yaml` →
`audit.readAuditException`.

**2. The deletion path is audited without exception.**
The deletion request, the recovery within the 30-day window, and the final purge. None of
the three is subject to this read exception, to a tenant policy toggle, to sampling, to a
rate limit, or to any later change made to reduce audit volume. **The purge audit record is
written *before* the personal data is destroyed** — see §6.1, where the ordering and its
failure analysis live.

**3. The enumeration gap is an ACCEPTED RISK, not an omission.**

> A principal holding only `customers.customer.list` can page the **entire customer base of
> their Organization** and leave **no audit trail**. With no `export` permission declared,
> the whole of that risk sits on `list`. This is **accepted for the MVP slice on the user's
> explicit instruction**, and it is **not a finding to be rediscovered later**.

This revision widens it slightly, and that is stated rather than absorbed: a business-scope
principal's reads are equally untraced, and `list` now also enumerates the pending-deletion
queue.

**The future obligation, named concretely so the cheap control is not lost behind the
expensive one:** *coarse-grained enumeration auditing* — **who** enumerated, **when**, and
**how many results** — and deliberately **not** an audit record per individual record read.

The distinction is the whole point:

| | Per-read auditing | Enumeration auditing |
|---|---|---|
| Cost | An audit write on every detail view, on the busiest read path in the product, on a single-threaded shared D1 | One record per `list` or `search` call — not per row |
| Value | Low. Produces a log nobody can read | High. Bulk exfiltration **is** enumeration, so this is the thing that would actually catch it |

**We are deferring the cheap, useful one — not the expensive one.** That is the honest
description of what this exception costs, and it is why the obligation is written down as a
specific mechanism rather than as "audit reads one day".

---

### CD-8 in full: why ADR `0011` was needed

**Resolved.** This section is kept in the past tense as the record of *why*
`docs/decisions/0011-manifest-lifecycle-indefinite-retention.md` exists. Deleting it would
leave `0011` looking like an arbitrary schema preference rather than a forced correction.
**Nothing here is an outstanding problem.**

**What this App declares:** `lifecycle.onUninstall: retain`, and **no `retentionDays` field
at all**.

**Why that was not possible before `0011`.** `app-manifest.schema.json`'s `lifecycle` block
describes what happens to tenant data **when the App is uninstalled**: `onUninstall` names
the disposition, and `retentionDays` was required alongside **both** `retain` and `archive`
to say how long the data is held afterwards. The decided 30 is a different quantity in every
respect:

| | `lifecycle.retentionDays` | `customerDeletionRetentionDays` |
|---|---|---|
| Trigger | The Organization **uninstalls the App** | An authorized user **deletes one customer** |
| Subject | The whole directory | One record |
| Meaning of the number | A period after which data is **disposed of** | A window during which the act can be **undone** |
| At the end | Data goes | Data goes — but only for the one record explicitly deleted |

So `lifecycle: { onUninstall: retain, retentionDays: 30 }` would have asserted that thirty
days after uninstall, the Organization's entire customer directory is disposed of. That is
the opposite of the decision, which says archived customers are retained indefinitely and
that **no automatic purge may ever remove an active or merely archived customer**. It would
also have been a false statement shown to the tenant on the uninstall screen, which is the
one place `APP_STANDARD.md` §9 requires the manifest to be true. `retentionDays: 0` was
worse, not a workaround: the natural reading is "retain for zero days", which is
deletion-on-uninstall wearing the word *retain*.

So the manifest could not be authored truthfully at all, and the slice was blocked on a
**schema defect** rather than on a missing number. `architecture-agent` refused to write the
number and reported it, rather than making the manifest validate and lie.

**How `0011` resolved it.** It rejected a sentinel value — a magic number in an integer
field is a comment pretending to be data, and every consumer that does not know the sentinel
silently reads it as a duration — and rejected a second agreeing field, because two fields
that must agree is a new way to be inconsistent. Instead it **redefined `retain` to mean
indefinite**:

| `onUninstall` | Meaning | `retentionDays` |
|---|---|---|
| `retain` | Held **indefinitely**. Removed only by an explicit authorized action. | **Forbidden** |
| `archive` | Held for a bounded period, then disposed of. | **Required** |

The word already carried that meaning in English; the schema was contradicting it. An App
that wants a bounded hold declares `archive` and says how long. This App must never lose
tenant data on a timer, so it declares `retain` and says nothing further — because under
`0011` there is nothing further to say.

**The 30 did not move and was never homeless.** It lives in the contract's `retention` block
as `customerDeletionRetentionDays`, because it is a per-customer deletion recovery window and
not a lifecycle property of the App. The two were never one number recorded in two places;
they were two different quantities that one field would have conflated.

**This contract did not edit `app-manifest.schema.json`.** A manifest format change touches
the SDK, Studio, `APP_STANDARD.md` and every future published manifest, and the AZ7 precedent
recorded in `permission-catalog.yaml` says such a change needs its own decision record —
which is what `0011` is. The schema edit was made by the agent holding that file under the
Team Lead's sequencing, and it is **done**: `app-manifest.schema.json` now carries both
`0011` clauses — `retentionDays` **required** under `archive`, **prohibited** under `retain`
— so a manifest declaring `retain` with a duration fails validation rather than treating the
number as advisory. No file was edited by two agents.

**A second format defect was found the same way and is also resolved.** `apis[].path` was
constrained to `^/[a-z0-9\-/{}]*$`, excluding the underscore, so `/customers/{customer_id}`
could not be expressed — while `API_STANDARD.md` §5 mandates `snake_case` on the wire and
its own worked example, `/api/v1/orders/{order_id}`, was rejected by the pattern. Writing
`{customer-id}` would have validated, at the cost of a `kebab-case` parameter on the wire in
a platform that mandates `snake_case` — the same move as writing `retentionDays: 30`, and
declined for the same reason. `docs/decisions/0012-manifest-api-path-underscore.md`
(**Accepted**, 2026-09-02) widened the class to `^/[a-z0-9_\-/{}]*$`. Nothing else changed
and no existing manifest is invalidated. `httpBinding` remains the normative route
declaration either way.

## 11. Dependencies this contract cannot satisfy itself

Stated plainly so nobody discovers them mid-implementation:

**Resolved since the previous revision, and stated so it is not re-raised:** ~~the nine
permissions are not in `permission-catalog.yaml`~~. **All nine are registered** as of
2026-09-02, at exactly the scopes declared in §10 CD-2 — `create`, `read`, `list`, `update`,
`archive`, `restore` at `[organization, business]`; `move`, `delete`, `restore-deleted` at
`[organization]`, with `delete` at sensitivity `critical`. Seed grants applied:
`business-owner` all nine, `business-admin` the six declared `[organization, business]`,
`member`/`developer`/`platform-admin` none. **The registration block is gone.**

Registration does **not** accept this contract and does **not** make an Action reachable on
its own. Item 3 below still stands, and it is a different gate.

1. **AZ2 — no authentication mechanism is recorded.** This contract assumes an
   authenticated principal, a server-derived tenant, **and a server-derived authorized
   business set**. It cannot produce any of the three, and it is written so it does not
   depend on which scheme is chosen. The business set is the new dependency this revision
   adds: it is part of the authorization decision, not a per-Action lookup.
2. **AZ5 — the grant path is defined for the seed roles and undefined beyond them.** The
   seed grants above are real. What is still unrecorded is how a *custom* role or an
   `own`-scope permission comes to be held at all. See CD-2 and catalogue AZ5.
3. **The platform confirmation/elevation mechanism does not exist**
   (`AUTHORIZATION_STANDARD.md` §7), and this is now the **only** thing blocking
   `customers.DeleteCustomer`. It is `critical`, so it needs permission + audit + an
   explicit confirmation collected by the platform from the human. **Holding
   `customers.customer.delete` is not sufficient to invoke it** — the confirmation gate is a
   separate requirement, so nothing became reachable by being granted. This is why
   `DeleteCustomer` and `RestoreDeletedCustomer` are **out of scope for the MVP
   implementation** (§11.1). See CD-13.
4. **`Business` lifecycle is Core's**, and this contract depends on Core not deleting a
   Business out from under a customer. See CD-14.
5. **A scheduled execution path is needed for the purge** (§6.1). Cloudflare cron triggers
   are part of the already-approved Workers service, so no new product is required, but the
   job itself is Core's to design and it does not exist. **Out of scope for the MVP** for a
   simpler reason than that: nothing can enter `pending_deletion` while `DeleteCustomer` is
   unreachable, so there is nothing to purge (§11.1).
6. **AP2 / SE2 — the App runtime and isolation mechanism are unrecorded**, and
   `0008` prohibits Workers for Platforms as paid-only. `APP_STANDARD.md` AP2 states that
   official Apps run in-platform under the same manifest enforcement, which is the path
   this slice needs; **that it applies in Phase 1 rather than Phase 4 is a sequencing
   question for the Team Lead.** No third-party App runs until the isolation record exists,
   and this contract does not assume one does.
7. **TS1 — no test framework is approved**, so none of the tests §12 requires can be
   written yet. The obligations are recorded regardless.
8. **MT5 — no search engine is approved.** §7 is deliberately designed not to need one.

---

## 11.1 MVP implementation scope — what is built, and what is contracted but not built

**Team Lead ruling on CD-13, 2026-09-02. Binding. Read this before implementing anything.**

| | Actions |
|---|---|
| **In scope — build these** | `CreateCustomer` · `GetCustomer` · `ListCustomers` · `SearchCustomers` · `UpdateCustomer` · `ArchiveCustomer` · `RestoreCustomer` · `MoveCustomerToBusiness` |
| **Out of scope — contracted, not built** | `DeleteCustomer` · `RestoreDeletedCustomer` · the purge job |

The two Actions are **fully contracted** here — shapes, errors, permissions, scopes,
transitions, audit obligations, HTTP binding — and are **not to be built in this slice**. No
implementing agent writes a handler, a route, a client screen, an SDK method or a test
assertion that exercises either, and **no reviewer reads their absence from the
implementation as an oversight.**

**Why they are contracted anyway — contracting is not scheduling.** The user's MVP scope is
create, list, search, view, edit, archive, restore. Deletion arrived only as a *consequence*
of the CD-8 retention decision: once `archived` means "kept indefinitely", something must
eventually be able to end that, or the directory becomes unerasable and the retention policy
is a promise the product cannot keep. So the capability has to **exist** in the contract, with
its permission declared and registered, or the model is incomplete. What it does not have to
do is ship now. It is also the cheap moment: adding an Action later is additive, but adding
two lifecycle states, a nullable deadline field and a new `statusFilter` member *after* either
client ships is breaking under `API_STANDARD.md` §6.

**What blocks them.** `DeleteCustomer` is blocked by the platform confirmation mechanism
(CD-13, §11 item 3) — fail-closed, and correct for the one Action in this App that destroys a
tenant's data. `RestoreDeletedCustomer` is not blocked by that mechanism; it is blocked by
having nothing to act on. Its only legal entry state is `pending_deletion`, and nothing can
reach that state while `DeleteCustomer` is unreachable, so building it alone would produce an
Action that can only ever return `failed_precondition`.

**What must not be done to unblock them.** No implementing agent may **invent the
confirmation** — not a `confirm` boolean, not a typed-name field, not a client-minted token,
not a second call that sets a flag, not an SDK argument. Each replaces a platform control
with a request parameter an SDK caller or an AI principal can set for itself, which is
precisely the control §7 exists to be. Nor may the block be worked around by **downgrading
sensitivity** from `critical` to `sensitive`: the classification follows from the Action
destroying data irreversibly, so changing the label does not change what the Action does — it
only removes the control.

**What is NOT deferred, and must be built now.** The `pending_deletion` status value, the
nullable `deletion_scheduled_at` field, and the `pending_deletion` and `all` members of
`statusFilter` are **in scope** in the data model and the wire shapes. They are the parts
that are breaking to add later. **A client must tolerate a status it will never see in this
slice rather than crash on it** — that tolerance is testable now and is cheap now.

---

## 12. What must be tested

`qa-agent` owns these. Recorded here so the contract states its own verification.

**Tenant isolation — mandatory, and all five parts of `TESTING_STANDARD.md` §5:**

- The canonical two-Organization test, acting as a **fully privileged** principal in
  Organization A, against **every** surface of the **eight in-scope Actions** (§11.1): read,
  list, search, update, archive, restore, move, enumerate, infer. Every attempt returns
  `not_found` or an empty result. The same test is owed for `delete` and `cancel-deletion`
  when those are built — isolation coverage is per Action, and an Action added later brings
  its own isolation obligation with it rather than inheriting this run's result.
- **`az7-r3` specifically:** a schema-valid `GetCustomer`/`UpdateCustomer`/`ArchiveCustomer`
  whose only cross-tenant element is the `customer_id`. Rejecting the *header*, *query* and
  *body* tenant-override vectors proves input validation and must **never** be reported as
  cross-tenant coverage. Report the two halves separately or not at all.
- **`business_id` as a cross-tenant vector — new, and the highest-value new test.** A
  schema-valid `CreateCustomer`, `MoveCustomerToBusiness`, `ListCustomers` and
  `SearchCustomers` whose `business_id` names a Business of **Organization B** while the
  caller is authenticated in Organization A. Every one returns `not_found`, byte-identical
  to a `business_id` that exists nowhere. This is the vector this revision creates and it
  did not exist before.
- **Predicate-order tests, run against the storage boundary and not the handler.** With the
  organization predicate removed and the business predicate left in place, the suite must go
  **red** — a business predicate alone returns another Organization's customer, because
  Business identifiers are unique platform-wide. This is a *specific* negative control and
  it is the one that catches the failure §3.1 exists to prevent.
- **Per-query-path coverage, enumerated not estimated**, from the storage-boundary call
  sites. Minimum paths: list read, search read, detail read, create write, update read,
  update write, archive write, restore write, move read, move write, cursor continuation
  read, audit write. Added when the deferred Actions are built: delete read, delete write,
  cancel-deletion read, cancel-deletion write, **purge-job read, purge-job delete**.
- The `TenantStoreResolver` suite, including an **unmapped** Organization failing closed.
- The storage-boundary bypass test.
- The **negative control**: predicate, resolver and boundary each deliberately broken, the
  suite shown to go red, the red run recorded.
- **No aggregate leaks.** There is no total count in this contract; a test asserts one is
  not added silently. A per-Business count is the same class of aggregate and is likewise
  absent.

**Business-scope authorization — new, and separate from tenant isolation. Never report the
two together:**

- Wrong Business, right Organization → **`forbidden`**, on `GetCustomer`, `UpdateCustomer`,
  `ArchiveCustomer`, `RestoreCustomer` and an explicitly named `business_id` on
  `ListCustomers`/`SearchCustomers`.
- Wrong Organization → **`not_found`**, byte-identical to nonexistent, on all of the above.
  **These two assertions must appear as a pair in every case**; a suite that checks one
  without the other cannot show that the ruling in §3.2 was implemented rather than
  approximated.
- An unfiltered `ListCustomers`/`SearchCustomers` **filters silently** — customers in
  unauthorized Businesses are absent, with no error, no count and no cursor gap. Assert the
  absence, and assert that paging over a filtered set does not skip or duplicate rows.
- A business-scope principal cannot reach `MoveCustomerToBusiness`, `DeleteCustomer` or
  `RestoreDeletedCustomer` at all.
- A move whose destination is inside the Organization but outside the principal's authorized
  set → `forbidden`; whose destination is in another Organization → `not_found`.
- `business_id` is rejected on `UpdateCustomer` as an unknown field, and there is **no**
  route or code path by which it changes other than `MoveCustomerToBusiness`.

**Retention and deletion — DEFERRED WITH THE IMPLEMENTATION, not dropped.** `DeleteCustomer`,
`RestoreDeletedCustomer` and the purge are out of scope for the MVP (§11.1), so these tests
are **not written in this slice** — there is nothing to run them against, and a test suite
that exercises an unbuilt Action is a suite that fails for the wrong reason. They are the
verification the contract owes **whoever builds those Actions**, and they are recorded here
so that work starts from them rather than rediscovering them. Do not delete them; do not
report them as coverage.

- **The purge never touches `active` or `archived`.** Seed both, plus a `pending_deletion`
  row whose `deletion_scheduled_at` is in the past; run the job; assert exactly one row
  went. Then advance time by a year and assert the `active` and `archived` rows are still
  there. **This is the test that proves archive is not a countdown**, and it is mandatory.
- The purge does not remove a `pending_deletion` row whose `deletion_scheduled_at` is in the
  future — boundary-tested at the moment itself.
- The purge is **tenant-scoped**: a run for Organization A leaves Organization B's expired
  `pending_deletion` rows untouched.
- After purge, `GetCustomer` and `RestoreDeletedCustomer` return `not_found` **byte-identical
  to a foreign-Organization identifier and to one that never existed**.
- After purge, the audit trail still contains the customer's `customer_id` and action
  metadata, and contains **no personal data** — asserted by scanning the audit records for
  every field value the fixture used.
- `RestoreDeletedCustomer` within the window returns the record to `archived`, with
  `deletion_scheduled_at` null and every field intact.
- `deletion_scheduled_at` is non-null **if and only if** status is `pending_deletion`.
- A second `DeleteCustomer` does not extend, restart or shorten the window.
- `DeleteCustomer` from `active` → `failed_precondition` (CD-12's assumption, so that
  reversing the decision is a visible test change).
- **The purge audit record exists even when the deletion fails.** Force the row deletion to
  fail after the audit write and assert the audit record is present and the row is still
  there — the recoverable failure mode of §6.1. Then assert the retry succeeds and that a
  duplicate purge line is tolerated rather than treated as a defect.
- **The deletion path is audited under every configuration.** Whatever toggle, sampling or
  volume control exists or is later added, `DeleteCustomer`, `RestoreDeletedCustomer` and
  the purge still write their records. Assert this against the configuration surface, not
  against a default.
- **Reads write no audit record** — `GetCustomer`, `ListCustomers`, `SearchCustomers`.
  Asserted positively, so that the CD-1 exception is a tested decision rather than an
  absence nobody checked, and so that adding per-read auditing later is a visible change.

**Authorization matrix, per Action** (`TESTING_STANDARD.md` §6): unauthenticated →
`unauthenticated`; authenticated without the permission → `forbidden`; correct permission
at too narrow a scope → `forbidden`; correct permission and scope → success; resource in
another Organization → **`not_found`**; resource in an unauthorized Business of the same
Organization → **`forbidden`**; permission revoked, next call → denied.

**Contract tests bind both clients.** The web client and the Apple client are each verified
against these shapes. A shape one has and the other does not is a contract defect —
including `business_id`, `deletion_scheduled_at`, and the `pending_deletion` state, which a
client that only handles `active` and `archived` will render as a blank rather than as a
customer about to be destroyed.

**Specific to this contract:**

- `status`, `customer_id`, `tenant_id`, `organization_id`, `deletion_scheduled_at` and the
  metadata fields are rejected on create and on update as unknown fields; `business_id` is
  required on create and rejected on update.
- `UpdateCustomer`'s three-way absent / value / null semantics, per optional field.
- Every state-machine transition and every rejected transition in §6 — including
  `RestoreCustomer` refusing `pending_deletion`, and `MoveCustomerToBusiness` accepting
  `archived` but refusing `pending_deletion`.
- Every search rule in §7.3, including the 4-digit phone floor, `%` and `_` as literals,
  and that `notes` and `address` never match.
- `not_found` responses are byte-identical for a foreign-Organization identifier and an
  identifier that exists nowhere, apart from `request_id`.
- Page size maximum enforced at 100; cursor rejection cases all return the identical error,
  including a cursor replayed with a different `business_id`.
- Audit records exist for the **five in-scope mutating Actions** — create, update, archive,
  restore, move — **and for their denials**, including the wrong-Business denial, and
  contain **no** field values, field names only. The wrong-Business denial record does
  **not** contain the record's actual `business_id`. The same obligation covers delete and
  cancel-deletion when they are built.
- The purge writes an audit record in the purged customer's own Organization. Deferred with
  the purge (§11.1).
- **`DeleteCustomer` and `RestoreDeletedCustomer` are unroutable in this slice.** Assert it
  positively: the routes are absent or return `not_implemented`, and no path reaches a
  handler. An Action that is contracted but not built must be *provably* not built, or its
  absence is indistinguishable from a handler nobody noticed shipping — and this is the one
  Action in the App that destroys tenant data.

---

## 13. Files an implementing agent may change

The contract is agreed first; then implementation. Scope is explicit so it cannot drift.

| Agent | May create or edit |
|---|---|
| **Implementation (Team Lead assigns)** | `apps/customers/README.md`, `apps/customers/actions/**`, `apps/customers/domain/**`, `apps/customers/data/**`, `apps/customers/api/**` — **for the eight in-scope Actions only** (§11.1). **Not** `apps/customers/jobs/**`: the purge is out of scope for this slice. **Not** `manifest.json`: it **already exists** and is `0011`-compliant — implement against it, do not re-author it |
| `web-agent` | `platform/web/**` only |
| `app-agent` | `Dudo-Apple` only |
| `qa-agent` | `packages/testing/**`, `apps/customers/tests/**`, Apple test targets |
| `core-agent` | the **scheduler** the purge runs on, in `platform/core/**` — never the purge predicate, never a customer table, never a retention constant (§2). **Not in this slice:** the purge is deferred (§11.1) |
| **Team Lead only** (or an agent the Team Lead sequences) | `packages/contracts/registries/permission-catalog.yaml` (nine permissions **registered**), `packages/contracts/registries/core-object-registry.yaml`, `packages/contracts/registries/app-manifest.schema.json` (the ADR `0011` and `0012` changes), `apps/customers/manifest.json` (**authored**, `0011`-compliant), `docs/**` |
| **`architecture-agent` only** | everything in `packages/contracts/**` other than the registries above |

**No implementing agent edits this directory.** A contract the implementer can adjust is not
a contract. If a shape here is wrong, that is a finding for the Team Lead, who routes it
back to `architecture-agent` — it is never fixed at the call site.

**Two things no agent may do to unblock itself**, stated because both are the obvious
shortcut and both are wrong:

1. **Write `retentionDays` into `apps/customers/manifest.json` — any value, including 30.**
   Under ADR `0011`, `onUninstall: retain` means **indefinite** and `retentionDays` is
   **forbidden** under it. A manifest declaring both now **fails validation**, correctly.
   **Note the reason carefully, because it inverted and the instruction did not.** Before
   `0011` the prohibition was "the field cannot carry the meaning"; now it is "the field is
   forbidden under `retain`". An agent that remembers only the old reason could conclude the
   constraint lapsed when the schema changed and do precisely the wrong thing. It did not
   lapse — it hardened, from a rule this contract asked you to respect into one the schema
   enforces. The manifest declares `retain` and nothing further.
2. **Build `DeleteCustomer` or `RestoreDeletedCustomer` — or invent the confirmation, or
   downgrade `delete` from `critical` to `sensitive` — to get them past the gate.** Both
   Actions are out of scope for this slice (§11.1). The permissions being registered and
   granted does not change that: holding `customers.customer.delete` is not sufficient to
   invoke it, because the confirmation gate is a separate requirement.
3. **Add `business_id` to `updateCustomerInput`, or change it at any path other than
   `MoveCustomerToBusiness`.** It would make a two-call workflow into one and remove the
   audit entry and the organization-scope permission that the user's decision specifically
   required.
