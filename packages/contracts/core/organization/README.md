# Business Read — contract of record, v1

**Status: Proposed.** Not approved, not built, no code exists. `architecture-agent` authors;
the **Team Lead accepts**. Nothing implements against this until it is agreed
(`.claude/rules/workflow.md` §3).

Three artifacts, all normative together:

| File | Carries |
|---|---|
| `business-read-v1.schema.json` | The request and response shapes |
| `business-read-v1.contract.yaml` | The Action definitions, tenancy, authorization, HTTP binding, audit, free-tier impact |
| `README.md` (this file) | The reasoning, the rulings, the open questions, the test obligations |

**A type alone is not a contract**, which is why the shapes file is never the whole set.
**Nothing here is executed** — there is no JSON Schema implementation in this repository
(ADR `0009`), no `package.json` and no `node_modules`, and AS1 is undecided. Every shape is
normative and **hand-checked**. No report may describe any of it as validated.

### Revision, 2026-09-04 — the resolve route's wire form was wrong and is changed

As first authored, this contract bound `core.ResolveBusinessReferences` to
`GET /businesses/names` with `business_ids` as a **repeated query parameter**.
`platform/core/http/api.ts:253-266` rejects **any** repeated query parameter with
`invalid_argument` / `repeated_parameter` — *"a repeated query parameter is ambiguous. Taking
the first or the last is a precedence rule, and a precedence rule is a way for a caller to
shadow a value a reviewer assumed was authoritative."*

**So the Action could not succeed over HTTP for more than one identifier.** A one-element
batch worked; every real call failed at the transport before any Action was reached.

**Core's behaviour is correct and is not what changed.** The contract is what moves. The
route is now **`POST /api/v1/businesses/names`** with the array in a JSON body. The **shapes
did not change** — `business_ids` was always an array — and neither did `maxRowWrites: 0`,
the tenant scoping, the permission, the evaluated scope, the unknown-identifier ruling, the
positional guarantee, or the batch maximum of 25. Full ruling and what was verified in Core:
§8 below, and `business-read-v1.contract.yaml → httpBinding.theBatchCarrier`.

**It is a pre-approval revision, not a breaking change, and only because of the timing.**
Nothing is accepted and nothing has shipped. Had either been true, changing a route's method
and its request carrier would have been breaking under `API_STANDARD.md` §6 and would have
needed `/api/v2`. Both client agents are building against this contract now.

---

## 1. What this is, and what it deliberately is not

`business_id` is **required** on `customers.CreateCustomer` and is displayed on every
customer row and every customer record in both clients. It is opaque. Nothing published
resolved it to a name, and nothing published listed the Businesses a principal may file a
customer into. `Business` sits in `../../registries/core-object-registry.yaml` as a
tenant-scoped object with `appAccess: read-via-contract` — and there was no contract, so the
one access value the registry gives it was unrealisable.

`app-agent` found this while building the Apple client and **refused to invent a wire
shape**, isolating the gap in one file
(`Dudo-Apple/Dudo/Contracts/CustomerDirectory/BusinessReference.swift`, marked
`PLACEHOLDER — NOT A CONTRACT`). `web-agent` is building the same screens and would have hit
the same wall. This contract is the answer, and it answers **two questions and stops**:

1. **Resolve** one or more `business_id`s to display names, for rendering.
2. **List** the Businesses the authenticated principal is authorized over, for the create
   form's picker and the list filter.

### This is not the organization-structure slice

There is deliberately **no** Business create, update, delete, archive or lifecycle; **no**
hierarchy; **no** Branch; **no** Team; **no** membership or assignment management; **no**
settings; **no** Organization shape or Action; and **no** full `business` entity in the
shapes file. Each is a decision about Core's organization data model, none is settled by an
accepted record, and defining one here would be **deciding Core's shape as a side effect of
unblocking an App** — the shortcut `platform/core/migrations/0002_business.sql` refused, in
those words, when it declined a Business name column.

If a future task finds itself designing organization structure in these files, that is the
signal to **stop and request a separate contract**, not to extend this one.

### It is a Core contract, and that is not a judgement call

`Business` is a Core object. Its permission `core.business.read` is already registered. The
Customer Directory is an **App**: it may not own a Core object, may not reach Core storage,
and may not publish a contract over Core's data (`.claude/rules/security.md` §4,
`CORE_BOUNDARIES.md`). So this lives under `packages/contracts/core/organization/`, and the
Customer Directory consumes it exactly as the two clients do.

**Core does not grow here.** Two read Actions over an object Core already owns, under a
permission Core already declares, is Core answering a question about its own data — which is
what `read-via-contract` means. No customer concept, no directory concept and no App concept
appears anywhere in this contract.

---

## 2. Read this before reporting the gap as closed

**This contract closes the *contract* gap. It does not and cannot close the *data* gap.**
Two things it depends on do not exist, and neither is repaired here.

### 2.1 Nothing in Dudo stores a Business name

`platform/core/migrations/0002_business.sql` defines the `business` table as exactly
`(tenant_id, business_id)` and says so explicitly: *"There is deliberately NO Business name,
NO lifecycle or status, NO parent, NO Branch, NO membership, NO settings, and NO Organization
table … They belong to the organization-structure slice, with its own contract."*
`platform/core/identity/control-plane-store.ts` records the same refusal one level up for the
Organization and names the consequence: *"an Organization picker built on this port can list
identifiers and not names."*

**So `display_name` is `null` on every response from both Actions, today and until the
organization-structure slice lands.** Both clients render the raw `business_id` — which is
what the Apple placeholder already does.

**The field is contracted anyway**, and that is the point. A nullable response field costs
nothing today and is **additive** the day it starts carrying values. Left uncontracted, each
client invents its own name source and its own fallback, which is precisely the state
`app-agent` reported and refused to entrench.

What would close it: a name column on Core's `business` table, plus something that writes a
Business row. **Both belong to the organization-structure slice and neither is designed
here.** This contract states the dependency and stops.

### 2.2 The authorized business set is empty for everyone

`platform/core/identity/principal-authorization-source.ts` ships
`createDenyAllPrincipalAuthorizationSource`, whose `authorizedBusinessIds` is the **empty
array for every principal**, and it is the only implementation that exists. Its own header
says why: grants have no defined storage under `0007`, and an organization-scope principal's
Business set can only be computed by reading the tenant's `business` table — which is behind
`TenantStoreResolver`, **after** this step in `0014` §C.5's order.

**So today every principal gets an empty page from `ListAuthorizedBusinesses` and
`unresolved` for every identifier from `ResolveBusinessReferences`.** This is not caused by
this contract and is not repaired by it. It is the same reason `customers.CreateCustomer`
cannot succeed today for any `business_id`. It is correct fail-closed behaviour, **not a
defect to fix with a permissive default** — that "would be an authorization bypass wearing
the word default."

### 2.3 The honest statement

Both clients now have **one agreed shape, one agreed source of truth and one agreed
fallback**, and `app-agent`'s placeholder can be deleted rather than kept in step with a
second client's guess. **Neither client will show a Business name, or a non-empty picker,
until 2.1 and 2.2 are met.** Any report that describes this contract as unblocking the
Customer Directory end to end is overstating it.

---

## 3. Where these reads are served from

**Both Actions are served from the ordinary Action pipeline, from `ActionContext`, in the
tenant data plane. Neither touches the identity control plane.**

The whole implementation of this contract's authorization is a value that already exists.
`platform/core/tenancy/tenant-context.ts` declares `ActionContext.authorizedBusinessIds` —
*"the Businesses of that Organization this principal is authorized over, derived from the
authenticated context and NOT from the request"* — placed there by
`platform/core/action/pipeline.ts` from the sealed `AuthenticatedPrincipal`. Both Actions
read that array. Neither computes it, supplements it, or adds to it.

**Checked against the separation `0014` §C requires.**
`platform/core/identity/control-plane-store.ts` is explicit: the port is split in two, the
directory-backed resolver *"gets `TenantDirectoryStore` and cannot read a session, a principal
or a membership"*, and *"nothing puts either half on `ActionContext`, and an App cannot build
one."* This contract disturbs neither statement. It asks no question the control plane
answers — it resolves no Organization, reads no session, reads no membership, enumerates
nothing across tenants. It consumes a value the identity layer had **already computed and
handed forward**, one step later in §C.5's order:

```
session → principal → memberships → AUTHORIZED ORGANIZATION/BUSINESS CONTEXT
        → TenantStoreResolver → business data
                                 ↑ these two Actions sit here, with every other Action
```

The only storage read this contract will ever have is the **name lookup**, and it does not
exist yet because there is no name column. When it does, it goes through
`ActionContext.store` — the same `TenantScopedStore` every other Action uses, whose tenant
predicate is applied centrally and never hand-written — and it is narrowed to identifiers
**already proven to be in the caller's authorized set**, so it can neither widen the answer
nor probe.

**The negative control**, owed by `qa-agent` and mechanical: whatever module implements these
Actions must not import `platform/core/identity/control-plane-store.ts` or
`platform/core/identity/session-resolution.ts`, and must not name `Env` or a D1 binding. One
grep. It is the same control `control-plane-store.ts` already specifies for
`platform/core/action/**` and `apps/**`; this contract extends it to itself rather than
assuming it is inherited.

---

## 4. The unknown-identifier ruling

**An identifier not in the principal's authorized set resolves to `resolution: "unresolved"`,
`display_name: null` — identically, whether it names a Business of another Organization, a
Business of this Organization the principal is not authorized over, or nothing at all. The
entry is always present, at its requested index, with the requested `business_id` echoed.**

### The trap the request named, and it is the right one

A bulk resolve that returned only the entries it could resolve would disclose — by the
**length and membership of its response** — exactly which of the caller's identifiers exist.
That is a per-identifier `not_found` rebuilt out of array length, and it is *harder* to catch
in review because no error code appears anywhere. The positional guarantee is the control,
and it is stated in the **input** schema as well as the output schema because it constrains
both ends.

### Why the ruling is structural, not a promise

`ResolveBusinessReferences` tests membership of an array that arrived with the authenticated
context. **It performs no lookup of any kind for an identifier outside that array** — no
storage read, no directory call, no `existsInTenant`, nothing. The implementation does not
merely decline to distinguish the three cases: **it has no fact with which to distinguish
them.** Indistinguishability is a property of the data flow, not of a branch somebody wrote
correctly — the same reason `tenant-context.ts` withholds the organization identifier instead
of requiring every query to carry it: *"withholding the value is stronger than requiring its
use."*

### The strongest statement of it

**Resolve returns strictly nothing that List does not already return.** Everything in a
`ResolveBusinessReferences` response is derivable by the caller from a full paging of
`ListAuthorizedBusinesses`: the resolution state *is* set membership, and the name *is* the
row's name. **That is the proof that it is not an oracle** — not the reasoning about error
codes, which is downstream of it. Any future change that lets Resolve say something List
cannot say has broken this property and must be reviewed as a **new disclosure**, not as a
better error message.

### Why not a third state, given the Customer Directory returns `forbidden` there

The Customer Directory's step-5c ruling — `forbidden` for an in-tenant Business outside the
authorized set — was decided by a **data-corruption argument**: told `not_found`, a
business-admin concludes the customer is not in the system, has staff re-enter it, and the
tenant's own directory silently acquires a duplicate with a divergent address and its own
future invoices. The failure mode of the fail-closed answer *there* was corruption of the
tenant's own data.

**That argument does not reach here.** Nobody re-creates a Business because a name failed to
render; this contract has no create at all; and the client's response to `unresolved` is to
render the identifier — which is what it renders for a *nameless resolved* Business too.
Where the corruption argument does not reach, the fail-closed answer is the right one.

A third state would also **cost the structural property above**: answering "exists but not
yours" requires a storage lookup for identifiers outside the authorized set, which is exactly
the lookup this Action does not perform. It would not be a new label on an existing answer;
it would be a new query path, a new disclosure, and a new thing to get right on every future
edit. Recorded as **BR-1**.

**Adding a third member later is breaking** (`API_STANDARD.md` §6 — widening a returned value
set that callers switch on), and both clients switch on it. That is deliberate: the one
change that would reopen this oracle needs `/api/v2`, a Team Lead review and a decision
record, not a patch release.

---

## 5. CO1 — this is not a second route to a user's Organization list

`core-object-registry.yaml` open question **CO1**: *"a user's list of Organizations must never
be visible to any of them."* `control-plane-store.ts` names
`listMembershipsForPrincipal` as the reason CO1 stays answerable — the list is returned **to
the principal**, through a session the principal holds, and *"there is no path from an Action,
an App, or an Organization administrator to this call. If this ever becomes reachable from
`ActionContext`, CO1 is violated in one line."*

**`ListAuthorizedBusinesses` is not a smaller `listMembershipsForPrincipal` and must never be
implemented on top of one.**

**What it can return.** Business identifiers, and eventually Business names, of Businesses
inside **the one Organization the authenticated session has selected** — and, within that
Organization, only those in the principal's own authorized business set. For a business-scope
principal, the single Business it is assigned. For an organization-scope principal, every
Business in that Organization. Nothing else.

**What it can never return** — an explicit list, because a prohibition that is only implied is
one somebody optimises away:

1. No `organization_id`, in any field, of any shape, including anything from which one could
   be recovered.
2. No list, count, hint or existence signal concerning any Organization — not the caller's
   others, not anyone's, not the number of them.
3. No Business of any Organization other than the authenticated one.
4. No membership, principal, session, role or grant, for the caller or for anyone else.
5. Nothing derived, however indirectly, from `listMembershipsForPrincipal`,
   `findMembershipWithOrganization`, `findSession`, `findPrincipal` or `findEntry`.
6. No cross-Organization uniqueness, ordering or adjacency signal.

**A principal belonging to three Organizations calls `ListAuthorizedBusinesses` and learns
nothing about the other two.** It receives one page of one Organization's Businesses,
indistinguishable in shape and size class from what a single-Organization principal receives.

**Why that holds structurally**, on three independent grounds:

- **The handle does not exist.** An Action receives only `ActionContext` — no
  `organizationId`, no binding, no `Env`, no control-plane port. Constructing a control-plane
  adapter needs a D1 binding an Action never sees. There is no method to call.
- **The value is already scoped.** `authorizedBusinessIds` is computed for **one validated
  membership in one Organization** (`PrincipalAuthorizationRequest` carries that membership,
  not a caller-supplied Organization identifier). A cross-tenant answer would have to be
  manufactured from a value that never contained one.
- **The shapes cannot carry it.** No shape has an Organization property, and
  `additionalProperties` is `false` throughout.

### The one way to break it, stated so it is recognisable in review

It is a change that will look like a feature: **an Organization switcher.** "Show me every
Business I can reach, across my Organizations" is a reasonable-sounding product request, it
is the natural next ask from whoever builds the picker this contract serves, and satisfying
it *inside this Action* requires exactly the control-plane handle CO1 forbids.

**It is not an extension of this contract.** An Organization switcher is an identity-layer
feature answered by the session's own `selectOrganization` path (`0014` §C.6), through a
session the principal holds. It needs its own contract, its own review and its own CO1
argument. Recorded as **BR-2**.

---

## 6. Permissions — both Actions use `core.business.read`

`core.business.read` already exists in `../../registries/permission-catalog.yaml`: group
`organization`, sensitivity `read`, scopes `[organization, business]`, status proposed,
phase 1. **This contract requests no new permission and no catalog edit.** It is the first
contract to use a permission the catalog already declared, which is what that catalog is for.

Seed holdings, unchanged and not proposed to change: `business-owner` at organization scope,
`business-admin` and `member` at business scope; `developer`, `platform-admin` and
`marketplace-moderator` hold nothing here. Note that **`member` can see its own Business's
name and cannot create a customer** — it holds `core.business.read` and none of the nine
`customers.*` permissions. Two independent decisions; this contract changes neither.

### Why list and resolve share one permission

The catalog's own rule is *"list is a separate permission from read. Enumeration is its own
disclosure,"* and there is no `core.business.list`. So this has to be argued, not assumed.

**The rule protects against enumerating a population you may otherwise only read one at a
time.** That is a real risk in the Customer Directory: the identifiers and shape of a tenant's
customer base are information even when the records are not readable, and a directory is a
population far larger than any one principal needs.

**Neither condition holds here.** `ListAuthorizedBusinesses` returns *exactly* the set the
caller's `core.business.read` grant already covers, at the scope it holds it, and not one
Business more. For a business-scope principal that is one row; for an organization-scope
principal it is the Organization's Businesses — which is precisely what holding
`core.business.read` at organization scope *means*. There is no wider population the Action
could reach, so there is no second disclosure for a second permission to guard.
**Enumerating precisely what you may read, and nothing more, is not a second disclosure.**

And the alternative is not actually safer. A new `core.business.list` would be held by nobody
until granted, leaving a principal unable to discover **any** valid `business_id` — a field
that is *required* on `CreateCustomer`. The result is not a narrower system; it is one in
which a principal cannot be told what it is authorized over, and the practical repair is each
client inventing its own picker source. That is the drift this contract exists to end.

**The boundary of this ruling.** It covers listings whose row set **is** the caller's own
authorized set. An Action that lists Businesses **beyond** it — an administration screen
showing every Business including unassigned ones, a platform-scope view, a cross-Organization
view — is a genuine enumeration of a wider population and **is not covered**. That Action
needs `core.business.list`, declared at that time, in a different contract.

**Deliberately not declared, so nobody can hold either:** `core.business.list` and
`core.business.export`.

### Evaluated scope is `business` on both Actions

The Action's `scope` is **the level its permission is evaluated at**, a single value — not
the list of scopes the permission may be declared at. Confusing the two is the silent
privilege escalation `AUTHORIZATION_STANDARD.md` §4 warns about.

A grant at a level implies the levels beneath it and never above it, so `business` means
`business-owner` (holding at organization scope) satisfies it everywhere in its Organization,
and `business-admin` and `member` satisfy it too. **Declaring `organization` would have locked
out every business-scope principal** — the exact error the Customer Directory records: had
its record-level Actions declared organization scope, *"business-admin would still be locked
out, and the decision would have been recorded in the permission catalog while changing
nothing at the entry point."* A business-admin that cannot list its own Business cannot fill
in the one required field on an Action it does hold.

**The scope declaration is the floor, never the whole check.** The response is still bounded
by `authorizedBusinessIds`: a business-scope principal satisfying a business-scope Action
still sees only its own Business, because the answer comes from the **set**, not the scope.

---

## 7. Ordering, pagination and the batch maximum

- **Order is fixed and total:** `display_name` ascending by Unicode code point **with nulls
  last**, then `business_id` ascending as the tiebreaker. No sort parameter in v1. A total
  order is what makes a cursor correct; ordering on a non-unique or nullable field alone
  silently duplicates and skips rows across pages.
- **The order names a field that has no source yet, deliberately.** Every name is null today,
  so the order degenerates to `business_id` ascending — and it becomes name order, **with no
  contract change**, the day names exist. Settling the sort now is free; settling it later is
  breaking.
- Code-point order is not locale-correct for Arabic or accented Latin scripts. Same root
  cause as the Customer Directory's CD-6, recorded here as **BR-3**.
- **Cursor pagination only.** Default page size 25, maximum 100, both documented. The cursor
  records `page_size` and the tenant it was issued for; malformed, expired, forged,
  wrong-tenant and wrong-page-size cursors all return the same `invalid_argument` with the
  same message and detail token. A cursor is a position, never a scope.
- **No total count** (`../../common/pagination.schema.json`). Concrete consequence: neither
  client can show "12 businesses".
- **The resolve batch maximum is 25, and it is a chosen number.** It is the documented default
  page size, so a client rendering one default page of customers can resolve every distinct
  Business on it in a single call; at page size 100 it makes at most four calls, and in
  practice fewer. **The query-length half of this argument has gone** — the identifiers no
  longer travel in a URL (§8) — and the maximum is deliberately **not** raised on the strength
  of that. Raising it is additive and is not proposed here.
- **Both maxima are disclosure controls as well as performance ones.** They are what stop a
  read permission from being an undeclared bulk export in one call, and `export` is a
  permission this contract deliberately does not declare.

---

## 8. HTTP paths — cheap now, breaking later

`businesses` **is** an allocated segment in `core-object-registry.yaml`, owner `core`. These
routes are in the flat Core namespace by right, not by allocation request.

```
GET  /api/v1/businesses            core.ListAuthorizedBusinesses
POST /api/v1/businesses/names      core.ResolveBusinessReferences
     { "business_ids": ["<id>", "<id>", …] }
```

**`GET /businesses` claims the canonical route, and the Team Lead should decide this
deliberately, because it binds the organization-structure slice.** That slice will want
`GET /businesses` too. The claim is made on the ground that a collection endpoint always
returns what the caller is authorized to see — exactly what `ListCustomers` does when it
silently filters rows in unauthorized Businesses — so *"the Businesses you may see"* **is** the
correct meaning of `GET /businesses`, not a narrower thing wearing a general name.

The consequence: that slice may **add fields** to `businessSummary` (additive) and may **not
widen the row set** beyond the caller's authorization (breaking, *and* an authorization
defect). If the Team Lead would rather reserve `GET /businesses` for it, the alternative is a
narrower path decided **now** — changing it after either client ships is breaking under
`API_STANDARD.md` §6 for a cosmetic path. Recorded as **BR-4**; it is the same
cheap-now-breaking-later finding the Customer Directory recorded as CD-7.

**`/businesses/names` is a sub-resource read, not a verb in a path** — `names` rather than
`resolve` or `lookup`, on both counts. **The segment is also five characters, and that is
load-bearing.** `businessId`'s pattern is `^[A-Za-z0-9_-]{8,64}$`, so **any sub-path segment
of eight or more word characters is a syntactically valid `business_id`** and would collide
with the `GET /businesses/{business_id}` the organization-structure slice will certainly add.
`references`, `resolution` and `authorized` all collide; `names` cannot. The Customer
Directory's `/customers/search` is safe by the same arithmetic — six against a minimum of
eight — and safe **by luck rather than by statement**, so the rule is written down here:

> A sub-path segment under a collection whose members are addressed by an opaque identifier
> must not be a syntactically valid identifier.

### `POST` for the batch, and why the original `GET` could not work

The first version of this contract said *"`GET` rather than `POST`, because it is a read with
no side effect and a POST would make a read look like a write to every intermediary, every
reviewer and the write-budget admission port."* The instinct was right and **the form it
chose was unusable**: the identifiers travelled as a repeated query parameter, and
`platform/core/http/api.ts:253-266` rejects every repeated query parameter for every route.
The Action could not resolve more than one identifier over HTTP.

**Four facts read in Core's source, not inferred** — a contract that assumes a transport
behaviour is how this defect happened the first time:

1. `http/api.ts:253-266` — repeated query parameters are refused, with no exemption
   mechanism. This is what made the previous form unusable.
2. `http/api.ts:95` and `:227-251` — `POST` is in `METHODS_WITH_BODY`; the body is parsed as
   a non-array JSON object and merged. **An array-valued property reaches the Action
   unchanged.**
3. `http/router.ts:208-241` — `mergeInputSources` coerces only the route's declared
   `integerQueryParams`. No other coercion exists, and none is needed: a JSON array is
   already the declared type.
4. `action/pipeline.ts:593` — **the entire daily-write-admission path is gated on
   `writes.length > 0`**, and the reserved cost comes from the Action's declared
   `maxRowWrites`. The HTTP method reaches the write budget nowhere at all. The original
   contract's "the write-budget admission port" concern was, on the code, unfounded.

**A delimited query parameter was considered and refused**, and the delimiter was not the
problem — the generated alphabet is base64url (`kernel/ids.ts`, `[A-Za-z0-9_-]`), so a comma
is safe. It was refused because it puts a *splitting rule* at the transport, which is the
same class of thing Core has just declined twice; because it needs a second coercion list on
`Route` that this contract is not entitled to request; and because it multiplies the invalid
cases — empty segments, trailing delimiter, encoded delimiter, whitespace, and duplicate
detection *after* the split — each a new token both clients and `qa-agent` must hold
identically. The JSON array has none of them.

**What the POST costs, unsoftened:** a read behind POST looks like a write to a reviewer
skimming a route table and to an intermediary, and `API_STANDARD.md` §5's own POST
sub-resource example is a mutation. The controls against being read as one are declarative
and all in the contract: sensitivity `read`, `maxRowWrites: 0`, `audit: false`, no event,
and `freeTierImpact.notConsumed`. §5's "no verbs in paths" still holds — `names` is a noun,
and the path did not change.

**What it buys, beyond working at all: the identifiers leave the URL.** The previous form put
up to 25 tenant-internal identifiers into access logs, proxy logs, browser history and
`Referer` headers, and this contract had *accepted* that as a residual — reasonably, since a
`business_id` is opaque, unguessable and tenant-internal, and `MULTITENANCY_STANDARD.md` §4's
log carrier is about **tenant** identifiers, which appear nowhere here. The residual is now
removed rather than argued, on the one route whose URL was composed entirely of
caller-supplied values. **What is still prohibited:** no log, metric label or trace attribute
may carry a `display_name`, which is tenant business-confidential data.

**Idempotency.** Neither route accepts, requires or honours an `Idempotency-Key`. For the GET
that follows from `API_STANDARD.md` §9 directly. For the POST it is a **ruling**, because §9
defines an unsafe operation *by method* and this is a POST that is safe: there is no effect to
suppress on a retry, so a key-store row would be a durable write bought for nothing by an
Action declaring `maxRowWrites: 0`. Recorded as **BR-7** — whether §9 should define unsafety
by the Action's sensitivity rather than by the method is the Team Lead's to decide.

**No `Cache-Control` that permits shared caching.** Both responses are per-principal and
tenant-scoped; a shared or edge cache keyed on the URL alone would serve one Organization's
Business names to another. The resolve route is the dangerous one — its URL is composed
entirely of caller-supplied identifiers, which makes it the most cacheable-*looking*.

---

## 9. Open questions — decided-around, not buried

Each was worked around to produce this contract. The assumption made is stated in every case.

| # | Question | Assumption made | Who decides |
|---|---|---|---|
| **BR-1** | Should an in-tenant Business the principal is not authorized over be distinguishable from an unknown identifier, as the Customer Directory's step 5c does? | **No.** Two-member enum; the three unresolvable cases are structurally indistinguishable. §4. | Team Lead |
| **BR-2** | An Organization switcher will be asked for, and it is the one change that breaks CO1. | **Out of scope, permanently, for this contract.** It is an identity-layer feature with its own contract. §5. | Team Lead |
| **BR-3** | Unicode code-point ordering is not locale-correct for Arabic or accented Latin. | Code-point order, matching the Customer Directory's CD-6. Not solved here. | Team Lead / product |
| **BR-4** | Does `GET /api/v1/businesses` belong to this contract or to the organization-structure slice? | **Claimed here**, on the ground that a collection endpoint returns what the caller may see. §8. Breaking to change after either client ships. | Team Lead |
| **BR-5** | `auditOnDenial` is `false` on both, while `customers.GetCustomer` is `true`. | The user's 2026-09-02 ruling named `GetCustomer` specifically and has not been widened; there is also materially less to detect here. §10. | User, via Team Lead |
| **BR-6** | Should `ResolveBusinessReferences` be built in this slice, or deferred? | **Recommended for the slice, not ruled in or out** — `architecture-agent` does not rule its own contracts' implementation scope. If only one is built, build `ListAuthorizedBusinesses`. | Team Lead |
| **BR-7** | `API_STANDARD.md` §9 defines an unsafe operation **by method** (`POST`, `PATCH`, `DELETE`). `POST /businesses/names` is a POST that is safe, so the standard's definition is now false for one route in this contract. | **No `Idempotency-Key` is required or honoured on either route.** The Action stays `idempotent: false`. Whether §9 should key on the Action's sensitivity instead is not decided here. §8. | Team Lead |

**BR-6 in full.** At MVP scale a client can label every row from `ListAuthorizedBusinesses`
alone, because a customer whose `business_id` is outside the authorized set is never visible
to that caller: `ListCustomers` filters those rows out and `GetCustomer` returns `forbidden`.
Resolve earns its place on deep links, on detail screens reached without a listing, and when
the authorized set is large enough that paging all of it to label three rows is wasteful.
Adding an Action later is **additive**. **If it is deferred, the contract still stands as
authored**: neither client may substitute a local resolution rule, and in particular neither
may invent its own fallback for an unresolvable `business_id` — the normative rendering binds
both clients whether or not Resolve is built.

---

## 10. Audit

Neither Action writes an audit record on any path. Both are sensitivity `read`, consistent
with the Customer Directory's three read Actions.

`auditOnDenial` is `false` on both, and the omission is **reasoned rather than inherited**.
The user's 2026-09-02 denied-read ruling named `customers.GetCustomer` specifically; it has
not been widened to that App's own collections (open CD-15), and widening a ruling nobody made
to a contract the user has not seen would be worse here than there.

**There is also materially less to detect.** The control on `GetCustomer` exists to catch
cross-tenant identifier probing. `ListAuthorizedBusinesses` takes no identifier at all, so
there is nothing to probe with. `ResolveBusinessReferences` takes identifiers but is
*structurally incapable* of answering differently for a foreign, an unauthorized or a
fabricated one (§4), so a probing campaign against it learns nothing and there is no signal
for an audit record to carry.

If the ruling is widened to read Actions generally, these two are in scope of that widening
and this section is what should be revisited. It is not applied pre-emptively, because an
audit write on a denial is itself a write on a single-threaded shared database, and the
write-amplification risk the Customer Directory records as CD-17 is unbounded and unclosed.

**This contract takes no exception to any standard.** The Customer Directory needed a
documented `readAuditException` because `AUTHORIZATION_STANDARD.md` §6 classes explicit
access to *customer information* as sensitive at minimum. A Business identifier and a Business
name are the tenant's own organizational structure, not customer information, so sensitivity
`read` is correct and no exception is required to hold it.

---

## 11. What must be tested

`qa-agent` owns these. They are obligations, not suggestions, and several will **pass
vacuously today** for reasons stated — a vacuous pass must be reported as vacuous, never as
green.

**Tenant isolation.**

1. Two Organizations hold Businesses with the **same `business_id` value** — constructible,
   because `0002_business.sql` deliberately has no global unique constraint, and it is the
   negative control that proves the tenant predicate is applied. A principal of Organization A
   must never see B's row, and must not be able to tell that it exists.
2. `ResolveBusinessReferences` with a `business_id` that exists **only in another
   Organization** returns a response **byte-identical** — status, body, size class, headers,
   everything but `request_id` — to the same call with a fabricated identifier, and to the same
   call with an in-tenant identifier outside the authorized set. **Three inputs, one
   observable answer.** This is the central test of this contract.
3. Neither response body contains an organization identifier, in any field, in any encoding.
4. A cursor issued to a principal of Organization A, presented by a principal of
   Organization B, is **rejected** with the same `invalid_argument` as a malformed one — never
   honoured, never used to select or redirect.

**CO1.**

5. A principal with memberships in three Organizations calls `ListAuthorizedBusinesses` and
   the response is indistinguishable in shape and size class from a single-Organization
   principal's. No Organization count, no cross-Organization row, no adjacency signal.
6. **The grep:** the implementing modules do not import `control-plane-store.ts` or
   `session-resolution.ts`, and do not name `Env` or a D1 binding.

**Authorization.**

7. Deny by default: a principal holding no `core.business.read` gets `forbidden` from both
   Actions, decided **before** input validation, so a malformed request and a well-formed one
   produce the same `forbidden`.
8. A business-scope principal receives exactly its own Business from
   `ListAuthorizedBusinesses` — not the Organization's.
9. An organization-scope principal receives every Business in its Organization and no other.
10. Neither Action ever returns `not_found`, for any input.
11. Neither Action ever returns `quota_exceeded`, **including when the Organization's daily
    write budget is exhausted** — reads remain available (`0014` §A.10).

**The positional guarantee.**

12. `data.length === business_ids.length`, and `data[i].business_id === business_ids[i]`, for
    every request — including one where **none** of the identifiers resolves, and one where a
    resolvable identifier sits between two unresolvable ones. **No entry is ever omitted.**
13. Duplicates, an empty array, 26 identifiers, and a malformed identifier each return
    `invalid_argument` — **not** a success-path `unresolved` entry.

**The wire form — the regression test for the defect §8 records.**

13a. A resolve request carrying **more than one** identifier **succeeds over HTTP**. This is
     the test the original contract would have failed: the repeated-query-parameter form
     returned `invalid_argument` / `repeated_parameter` for every batch of two or more, and
     no shape-level test would have caught it because the *shapes* were always correct. It
     must be exercised **through the HTTP entry point**, not by calling the Action directly.
13b. **No route in this contract sends a repeated query parameter, in either client.** A
     client that builds `?business_ids=a&business_ids=b` is reintroducing the defect against
     a route that no longer has that method. One grep per client.
13c. The resolve route takes **no write reservation and never returns `quota_exceeded`**,
     including when the Organization's daily write budget is exhausted — the POST method must
     not have made a read into a write. This is test 11 pointed at the specific risk the
     method introduces.

**Ordering and paging.**

14. The order is total and stable across pages with names all null (today's state) and with
    names present (a fixture), including nulls sorting **last**.
15. Paging the full set returns every row exactly once, with no duplicate and no skip.

**The empty case, and the vacuous passes.**

16. A principal authorized over no Business receives `data: []` with `next_cursor: null` —
    **not** an error, and not a `not_found`. **Today this is every principal**, so tests 8, 9,
    14 and 15 pass vacuously against the deny-all `PrincipalAuthorizationSource` and must be
    driven by an injected authorization source in the test, with the substitution stated in
    the report.
17. `display_name` is `null` on every response. **Today this is universal**, so any test
    asserting a name must supply one through a fixture and must say so.

**Cross-client (`0016`).**

18. The web client and the Apple client both render the `business_id` **verbatim** when
    `display_name` is null — not a blank, not a dash, not an invented placeholder. A
    divergence here is a **contract defect**, not a local style choice.
19. Both clients handle the empty picker as a first-class state, identically.

**Drift.**

20. `businessId`'s pattern and bounds are **identical** in `business-read-v1.schema.json` and
    `customer-directory-v1.schema.json`. They are duplicated because no URN resolver exists,
    and a divergence is a contract defect of the same class as cross-client drift.

---

## 12. Files an implementing agent may change

This contract set — `packages/contracts/core/organization/**` — is **`architecture-agent`'s**
and read-only to everyone else.

| Work | Owner | Files |
|---|---|---|
| The two Actions, handlers and routes | `core-agent` | `platform/core/**` |
| Any Business name column or migration | **Nobody yet** — organization-structure slice, needs its own contract and Team Lead approval | — |
| Web consumption | `web-agent` | `platform/web/**` |
| Apple consumption, replacing `BusinessReference.swift` | `app-agent` | `Dudo-Apple/**` |
| Tests | `qa-agent` | `packages/testing/**`, Apple test targets |
| Accepting this contract; `docs/decisions/**` | Team Lead | — |

**Nothing is implemented until the Team Lead accepts this contract.** The two dependencies in
§2 are not repaired by any of the work above and must not be repaired as a side effect of it.
