# The administration split — platform administration and Organization administration

- **Owner:** `architecture-agent` authors; the **Team Lead accepts.** This document is a
  specification, not a decision record. Nothing here is Accepted until the Team Lead records it.
- **Date:** 2026-09-08
- **Governs:** every administrative screen, route and permission in Milestones 1–6.
- **Companion:** `docs/architecture/admin-capability-matrix.md` — which capability sits on which
  side, row by row.
- **Builds on:** `docs/decisions/0022` (three hostnames), `0024` (platform principal isolation),
  `0025` Decision 3 and both its amendments (the platform route class and `P1`), `0028` (what an
  operator may see), `permission-catalog.yaml` (`AZ3`, `AZ8`, `AZ9`),
  `core-object-registry.yaml` (`CO1`, `CO4`).

**Two documents rather than one, and this is the reason.** The matrix is a table that will be
edited on every milestone; this is a rule that must not move when the table does. A future author
deciding which host one screen belongs on needs an answer they can read in a minute, and a rule
that lives in the preamble of a table that long is a rule nobody opens.

---

## 1. The binding property

The user's words, 2026-09-08, and they are the whole of it:

> **A platform operator must not gain tenant business-data access merely because we are building a
> "full admin."**

Two surfaces, and a capability belongs to **exactly one**:

| Surface | Who signs in | What it administers |
|---|---|---|
| **`admin.dudo.work`** | A **platform operator** — a principal with a `platform_operator` row and **zero** `organization_membership` rows | The platform, and the control-plane record of each Organization |
| **`app.dudo.work/settings`** | A **tenant principal** — a member of one Organization, acting inside it | That Organization: its people, its structure, its Apps, its data |

`0022` already gives each host its **own host-only cookie**, so an operator's session is not
replayable against the application and a tenant's session is not replayable against the console.
That is a property the split inherits rather than one it invents.

---

## 2. The test, stated as a question a future author can answer alone

Ask them in order. The first one that answers, decides.

> ### Q1. Does the screen need to read a row that belongs to one Organization's business data?
>
> **If yes, it is Organization administration, and it cannot be built on `admin.dudo.work` at all.**

This is not a policy; it is what the code does. A platform operator holds no membership → selects
no Organization → obtains no `TenantStoreResolver` handle → `whereWithTenant` emits no predicate →
**no rows** (`0024`, "The good news first"). There is nothing to enforce, because there is nothing
to reach.

> ### Q2. Is the answer the same for every Organization, or does it name more than one?
>
> **If yes, it is platform administration.**

Templates, published App versions, capability definitions, the operator roster, the platform audit
feed. None of them names one customer's data; several of them are *about* customers and touch no
row inside one.

> ### Q3. Could the Organization's own owner decide this for themselves, without asking Dudo?
>
> **If yes, it is Organization administration.**

Who works here, what the Workspaces are called, which Apps are installed, what the tax rates are,
who may approve a payment. The platform has no business holding these, and holding them is how a
"full admin" becomes a shadow copy of every customer's operations.

> ### Q4. Nothing above decided it. It is a control-plane row that **names** an Organization.
>
> **Then it is platform administration — and it is the contested case, so say so in the
> specification rather than deciding it in a screen.**

`organization` status, the tenant-directory mapping, the commercial and VAT registrations. These
are the rows §4 below is about, and the ones the matrix marks as findings.

### The one-sentence version, for a reader who reads no further

> **The platform may write a customer's record of what was done to them. It may not read what they
> have.**

That sentence is not new here. It is `0025`'s amendment of 2026-09-05, adopted after *"exactly one
handler"* had already been false three times, and it is the correct instrument precisely because
it is a **property rather than a count** — a count makes every new component look like an exception
to be argued; a property makes it a case to be tested.

---

## 3. What a platform operator legitimately sees about an Organization

`0028` is the existing ruling and it is not reopened here. Restated so this document is usable
without opening it, and **checked against the shipped route table rather than paraphrased**:

**Permitted, and reachable today:**

- **The control-plane record** — `organization_id`, `status`, `created_at`, the display identity
  and the registrations. `platform.organizations.list`, `platform.organizations.read`.
- **`member_count`** — *"a count does not invert"* (`0028` Decision 4). Cardinality names nobody.
- **One member, resolved from an identifier the operator was already given.**
  `platform.organizations.members.resolve` — support, not surveillance, and the distinction is
  that a resolve *"requires the operator to know something only the customer could have told
  them."*
- **The operator action log**, in two feeds that differ in what they may disclose:
  `platform.audit.list` (all Organizations, `target_principal_id` **omitted**) and
  `platform.organizations.audit.list` (one named Organization, `target_principal_id` included).

**Refused, and the refusal is structural rather than a rule:**

- **A member list.** There is no `GET /organizations/{id}/members` and one must not be added.
  *"The transpose of the permitted read is the forbidden one"* — an operator can enumerate every
  Organization, so per-Organization member lists invert into `CO1`'s forbidden principal →
  Organizations mapping. Neither permission discloses it alone; the pair does.
- **Any count or summary of business records.** `organization-detail-v1` refuses these by name:
  *"'how many customers' is how a console acquires cross-tenant reach one convenient number at a
  time."*
- **Any `include=` parameter.** Absent from every platform route's `queryParameters`, and the class
  refuses an undeclared parameter with `invalid_argument` **before authentication** rather than
  accepting and ignoring it.
- **A platform-wide audit export.** `core.audit.export` is a *tenant* exporting its own log.

### Where admin-first pushes against `0028` — a finding, not a resolution

**Three places. All are reported to the Team Lead and none is decided here.**

1. **`0028`'s residual has two false terms and this scope makes them matter more.** The residual
   was accepted as *"N requests, audited in both homes, visible to each victim, rate limited."*
   The amendments of 2026-09-05 struck **"visible to each victim"** (the tenant audit read has no
   route — `PA-3`/`OD-2`) and **"rate limited"** (measured: 2,000 calls exhausted one named
   Organization's entire 10,000/day allocation). **Milestones 1 and 4 add operators and operator
   screens.** `0028` says explicitly that the surviving fixes bound the *attacker* while the
   exposure is a property of the *target*, and that the only structural answer — a per-Organization
   sub-ceiling on platform-originated tenant writes — was **deferred because the operator set was
   small.** Admin-first is the event that changes that premise.

2. **A "full admin" will be asked for a screen that shows an Organization's contents.** `0028`
   Decision 4 records that the deployed console already tells the truth about this — *"An operator
   cannot reach any tenant's data through the console… There is no screen for it because there is
   no route for it"* — and that when a brief and shipped copy disagreed, the copy was right.
   Anything that changes this is `AZ3` break-glass, which is undecided and must stay so until it is
   recorded with its own audit story.

3. **`OD-1` is now a product gap rather than a footnote.** An operator cannot verify after the fact
   that onboarding created a Workspace; the information exists at creation and nowhere afterwards.
   `0028` says the fix is a **tenant-side** view. Under admin-first the pressure will be to add a
   platform-side one, and that pressure should be refused with `0028`'s own sentence rather than
   re-argued.

---

## 4. The mechanism, and where it stops

`architecture.md` §3a: *a guard that must be remembered is a discipline; a guard whose output the
write requires is a mechanism.* Here is what is mechanism today, verified in the tree rather than
repeated from a decision record, and what is only discipline.

### 4.1 Mechanism — and it is strong

| Control | Where | What it makes impossible |
|---|---|---|
| **No membership → no store handle** | `tenancy/tenant-context.ts`, `0024` | A platform principal reading any tenant row, on any surface, at all |
| **`MembershipRole` carries no platform value** | `authorization/roles.ts::assertRoleMappingIsCoherent`, at module load | `0024`'s cross-tenant assembly. **This is the load-bearing invariant** — `0024`'s own amendment corrects the record on which of its two invariants carries the weight |
| **Two tables, mutually exclusive** | `platform_operator` vs `organization_membership`, four D1 triggers (`0010`) | A principal holding both — refused everywhere, never resolved in favour of either |
| **`PlatformRouteDependencies` carries no `TenantStoreResolver`** | `platform/core/platform/composition.ts` | The platform route class acquiring general tenant reach. The three services that legitimately need a bounded handle are **passed in pre-built** from `worker-entry.ts`, so the class's composition root never holds a resolver |
| **The platform path segment is reserved** | `core-object-registry.yaml`, `reservedApiPathSegments`, `segment: platform` | An App serving a path under `/api/v1/platform` and **presenting itself as the admin console** |
| **Platform routes are host-bound** | `platform/core/http/api.ts`, at the `matchPlatformRoute` branch — `isPlatformHost(dependencies.platformRoutes.adminHosts, url.hostname)`, answering **404**, one answer for "wrong host" and "not composed" | A platform route being reachable from `app.dudo.work` or `api.dudo.work` |
| **The operator-charge receipt** | `platform/core/platform/platform-audit.ts` — `OperatorWriteCharged`, minted only by `dispatchPlatformRoute`, **required parameter** of every tenant-writing service, subject compared on consumption | A platform route writing into a customer's database before the operator's own budget was charged. **Omission does not compile** |
| **Confirmation is derived from the permission** | `platform/core/confirmation/critical-permissions.ts` — 16 permissions, transcribed from the catalog, with `assertCriticalSetIsCoherent` and `assertConfirmationCoverageIsCoherent` at load | An Action or a route opting itself out of confirmation |
| **A route may not declare an unreachable permission** | `platform-routes.ts::assertEveryRoutePermissionIsReachable`, plus the `PLATFORM_PERMISSION_ENVELOPE` ceiling | Shipping a route that answers `forbidden` to every operator alive — which had already happened once |

**The host binding claim is verified, not repeated.** `core-object-registry.yaml` states that the
platform route block *"is additionally mounted ONLY on the admin host, and a request to
`/api/v1/platform/**` on `app.dudo.work` or `api.dudo.work` answers 404 rather than 403."* That is
correct: `http/api.ts`'s `matchPlatformRoute` branch matches the platform route first and returns
`renderError(notFound(), …)` unless the host passes `isPlatformHost`, whose production default is
the `DEFAULT_ADMIN_HOSTS` constant in `http/adapters/worker-entry.ts` — `['admin.dudo.work']` —
and which `PlatformCompositionInput.adminHosts` requires with **no default**, so an empty list
makes every platform route 404, the fail-closed direction.

**Every citation in this table names a symbol rather than a line**, per `architecture.md` §3c:
*in a file of repeated same-shaped blocks a line number is not an identifier.* Two of these files
are not repeated-block files and a line would have been stable in them — but **whether a line is
stable is something the reader cannot check from the citation, and a symbol name is.**

**And the registry is right that this is the second layer, not the first.** `composition.ts` says
so explicitly and the ordering matters: the reservation of the path segment is the structural
control; the host binding is defence in depth. A reviewer who treats the hostname as the boundary
has the layers inverted.

### 4.2 What is only discipline today, stated plainly

> **Nothing prevents a capability being built on the wrong surface in the tenant → admin
> direction. The mechanism runs in one direction only.**

- **Platform routes on an application host: refused.** 404, by `isPlatformHost`.
- **Tenant Action routes on the admin host: served.** `wrangler.admin.jsonc` gives `dudo-admin`
  the **same `main`** and the same D1 bindings as `dudo-core` — `0022`'s amendment says so in
  terms: *"Same `main`, same D1 bindings, same secrets, different `assets.directory` and different
  route."* So the Action pipeline, the session class and the pre-auth class all answer on
  `admin.dudo.work`. A tenant member can sign in there — the credential key is the same secret, and
  `wrangler.admin.jsonc` records that it must be — select an Organization, and reach their own
  tenant Actions from the console's origin.

**This is not a tenant-isolation breach and must not be reported as one.** Naming which side the
claim is about, per `architecture.md` §3b: **a platform operator gains nothing** — memberless, no
handle, no rows, on any host. **A tenant principal gains nothing they did not already have** — the
same Actions, the same single tenant, the same `whereWithTenant` predicate. The exposure is
**architectural rather than confidential**: the rule *"Organization administration belongs under
`app.dudo.work/settings`"* is, today, a convention held up by two SPA directories having different
owners.

**Why that is worth fixing before Milestone 2 rather than after it.** Milestone 2 is the first
milestone that builds a large number of tenant-administration screens, and the two consoles are
being built by two agents against one Core. The first screen placed on the wrong host **works** —
so nothing surfaces the mistake until someone reads the route table, and by then the console has a
URL customers use.

### 4.3 The smallest mechanism that would close it

**The mirror of the control that already exists, in the same function, in the same shape.**

> Give `CoreRuntimeOptions` a **`tenantHosts`** list beside `adminHosts`. In `http/api.ts`, when a
> request resolves to an **Action-class** or **session-class** route and the host is an admin host,
> answer **404** — the identical answer, for the identical reason, as a platform route on an
> application host.

Four properties make this the right size:

1. **It costs the admin console nothing.** Verified by enumeration rather than assumed:
   `platform/admin/src/**` calls exactly `/auth/login/complete`, `/auth/session/revoke` and
   `/api/v1/platform/**` (`api/auth.ts`, `api/platform.ts`, `api/confirmation.ts`). It uses **no**
   Action route and **no** session-class route. The pre-auth class must keep answering on both
   hosts, because the operator signs in there.
2. **It fails closed and it fails at the boundary**, not in a screen and not in a review.
3. **It is one comparison in one file** — the function that already holds `isPlatformHost`, so
   there is no second place the rule can differ.
4. **It needs a known-failing input, per `workflow.md` §11a**: a case asserting that
   `GET /api/v1/customers` on the admin host answers 404 must go **red** when the tenant-host check
   is removed. A check that has only ever been handed passing input has been observed, not
   verified.

**This is a proposal to the Team Lead. It is `core-agent`'s change to make** — it touches
`platform/core/http/**` and `platform/core/http/adapters/**` — and it is a deployment-shaped change
because `tenantHosts` is configuration, so it belongs to the Team Lead to sequence and to the user
to approve if it reaches a deploy.

### 4.4 The counter that this scope will push, and the right instrument for it

`0025` Decision 3 promised *"no `TenantStoreResolver` is reachable from this class."* That has been
amended twice: first to *"exactly one handler's closure,"* then — after it turned out to be three —
to a property, with the explicit finding that **counting was the wrong instrument all along**,
because it *"made every new component look like an exception to be argued rather than a case to be
tested."*

**Measured today, from the route table and from `directory/member-resolution.ts`'s
`TenantRecordedPlatformPermission` union:** **five platform routes write into a customer's tenant
database** — `platform.organizations.create`, `platform.organizations.members.resolve`,
`platform.credentials.reset`, `platform.organizations.audit.list` and
`platform.organizations.identity.update` — through **three modules** outside
`platform/core/platform/**` (`onboarding/`, `directory/`, `credential/`). **Every one writes. None
reads.**

**So the property holds and the counts in the code do not.** Two artifacts still frame it as a
count and are stale in the direction that invites the wrong conversation:

- `platform/core/platform/composition.ts`, at the **`readonly reset:`** field: *"THIS IS THE THIRD
  SERVICE ARRIVING THIS WAY AND `0025`'s AMENDMENT SAYS 'EXACTLY ONE'… A fourth is the point to ask
  whether P1 still means anything."* `0025`'s amendment **no longer says "exactly one"** — it
  replaced the count with the property later the same day, and said the count *"was never the
  line."* Reported to the Team Lead as `workflow.md` §12 residue: a decision being amended stranded
  a comment that cites it.
- The same comment sets a trigger — *"a fourth"* — that will fire on the wrong event. A **fourth
  write** is unremarkable. **The first read** is the line, and `0025` says so: *"a read would break
  the property while looking like the fourth instance of an accepted pattern — arriving with three
  precedents, a familiar shape, and a directory that already holds its neighbours. That is the
  line, and it is invisible to anyone counting."*

**Binding on Milestones 1–6, and this is the sentence to put in a review:**

> **Every new platform route states, in its specification, whether it writes into a customer's
> tenant database and whether it reads one. A write is a case to be tested against the property. A
> read is a `P1` breach and needs a decision record before any code exists.**

**And the check that keeps it honest is already written and must stay exception-free:**
`qa-agent`'s structural assertion that **no module under `platform/core/platform/**` names a tenant
primitive.** All three tenant-touching modules sit outside that directory. The day one moves
inside, the class itself can reach a tenant and the grep is the thing that says so.

---

## 5. Where a capability appears to need both surfaces

**A capability that looks like it needs both is a finding, and it is written as one row plus a
finding — never as two rows.** Two rows is how one concept becomes two contracts that drift.

**The rule for resolving it:** split the *capability*, not the *screen*. Ask what each side is
actually doing. `0028` is the worked example — an operator's *"resolve one member I was told
about"* and a tenant's *"list my own people"* look like one capability at two scopes and are two
different operations with different permissions, different disclosures and different audit
consequences.

**The live instance, and it is unresolved.** An Organization's **display name, commercial
registration and VAT registration** are set **only by a platform operator**
(`core.platform-organization.update`, `platform.organizations.identity.update`), because the
`organization` row is **control-plane** and, per `organization-identity-v1`'s `OI-1`, an Action
reaches no control-plane port. The catalogued tenant permission `core.organization.update` exists,
is granted to `business-owner`, and **has no route and cannot be given one over that table today.**

So: *"Organization administration belongs under `app.dudo.work/settings`"* collides with a customer
being unable to correct their own company name. **This is reported, not resolved.** It is the same
blocker as `core.organization.read`, `core.role.*` and every other catalogued tenant permission
whose object lives in the control plane, and it is the largest structural item standing between
Milestone 0 and Milestone 2. Whatever answers it — a fifth request class, a control-plane port
reachable from an Action under a bounded contract, or moving fields into the tenant database — is a
decision record, and `0025` Decision 3's rejection of a fifth class (*"a class containing both
would be a class with no consistent context"*) is what any proposal has to argue against.

---

## 6. What this document does NOT decide

- **`AZ3` break-glass access to tenant business data.** Nothing here permits it. `0024`'s
  invariants are what any proposal must argue against, rather than quietly relax.
- **Where a control-plane-owned tenant setting should live** (§5). Reported as a finding.
- **Whether `tenantHosts` is adopted** (§4.3). Proposed to the Team Lead.
- **The per-Organization sub-ceiling on platform-originated tenant writes.** `0028` deferred it on
  a premise admin-first changes; re-deciding it is the Team Lead's, and the spend and deploy
  consequences are the user's.
- **Any hostname.** Hostnames are deployment configuration and Core deliberately does not choose
  them (`composition.ts`: *"a hostname chosen in Core is a hostname nobody reviews"*).
