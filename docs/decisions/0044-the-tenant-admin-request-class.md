# 0044 — The tenant-admin request class

- **Status:** **ACCEPTED 2026-09-13 by the Dudo Team Lead.** Recorded after reading
  `architecture-agent`'s 190-line draft in full, not from a report about it — same discipline as
  `0042`, and for the same reason: a status field records that a specific reader checked specific
  text. **The draft at `docs/architecture/proposals/0044-draft-*.md` is superseded by this file and
  should be deleted rather than left as a second copy.**
- **Proposed by:** `architecture-agent`. **Ruled by:** Team Lead (§3d, and the derivation framing).
- **Governs:** where tenant-administration routes live, and what that class may never acquire.
- **Arises from:** Milestone 2 — Full Organization Administration.

---

## 1. The blocker, measured rather than argued

**Milestone 2 administers the Organization. Almost nothing it administers is in the tenant database.**

```
TENANT DB       audit_event · business · denial_summary
CONTROL PLANE   organization · organization_membership · session · membership_role ·
                principal · principal_credential · organization_identity · template …
```

**`ActionContext` (`tenancy/tenant-context.ts:131`) exposes `store: TenantScopedStore`, `audit`,
`cursors`, clock, ids and correlation — AND NO CONTROL-PLANE PORT.** Every handle is tenant-bound
and an Action never holds a tenant identifier at all. **Verified independently by the Team Lead
before this was accepted.**

**So the Action pipeline — the only tenant-facing request class — cannot read or write
`organization`, `organization_membership`, `session`, `membership_role` or `organization_identity`.**
That is members, roles, sessions, profile and registrations: the milestone.

**`organization-identity-v1`'s `OI-1` records this as a limitation of ONE FIELD. It is a property of
the whole surface** — and the permission catalogue already stated the mechanism without anyone
drawing the consequence: *"`organization` is control-plane and an Action reaches no control-plane
port."*

## 2. Two of the three options violate accepted rules

### 2a. A control-plane port on `ActionContext` — REFUSED, `security.md` §4, absolutely

**This is not a layering trade. ACTIONS ARE THE APP EXECUTION PATH** — `apps/customers/actions/**`
ships eight, and third-party Apps will run there.

> **§4: plugins and the plugin runtime must NEVER open a database connection, issue SQL, use a Core
> ORM model, read Core caches or reach Core files. THERE IS NO EXCEPTION TO THIS RULE FOR ANY
> PLUGIN, FOR ANY REASON.**

**A control-plane port on `ActionContext` is reachable by every Action.** Refused outright rather
than weighed.

### 2b. Move tenant-editable settings into the tenant database — REFUSED, `0030`

**A SCHEMA cost paid to avoid a CONFIGURATION one** — the exact inversion `0030` forbids. **And it
leaves `OI-1` permanently open:** a customer unable to correct their own legal name, recorded as a
limitation and then made structural.

### 2c. A fifth request class — the only lawful path

> **WHEN ONLY ONE OPTION DOES NOT VIOLATE AN EXISTING RULE, THAT IS A DERIVATION RATHER THAN A
> DECISION.** Recorded so this is not read a year from now as a preference that could have gone
> otherwise.

**No fourth option exists and it was looked for.** The session class (`0021`) evaluates no
permission. The platform class (`0025` D3) has no tenant and is unreachable by a tenant principal
under `0024`. **An event or queue hop is §4 with indirection — the App path still reaches it.** A
read-only projection of control-plane data into the tenant database is §2b with a synchroniser.

## 3. The class

**Authenticated at principal level · tenant resolved from the authenticated context · permission
evaluated · reaches control-plane ports · reaches no other tenant, ever.** Modelled on `0025` D3:
its own registry, its own reachability assertion, no wildcard, fail-closed on an unrecognised route.

| | pre-auth `0014` §B | session `0021` | **tenant-admin** | platform `0025` D3 | Action |
|---|---|---|---|---|---|
| principal | none | session-level | **yes** | yes | yes |
| tenant | none | none | **YES, from context** | none | yes |
| permission | none | none | **yes** | yes | yes |
| control plane | — | — | **YES** | yes | **no** |
| App-reachable | no | no | **NO** | no | **YES** |

**The last row is the whole safety argument for creating a class rather than widening one.** §4 is
preserved by the two being **different classes**, not by a check inside one — and 2a would have put
them one shared port apart.

### 3a. Why it is safe

> **The class resolves a tenant from the authenticated context, and a platform operator holds no
> membership — so NO PLATFORM OPERATOR CAN REACH IT BY CONSTRUCTION, NOT BY A CHECK.**

`0024`'s mutual exclusion doing the work. **It is the one place where the two administrations cannot
merge by mistake.**

### 3b. What the class must never acquire — a class is where reach accumulates

1. **No cross-tenant read of any kind** — not a count, not an existence check, not an error that
   distinguishes another tenant's identifier from a nonexistent one.
2. **The tenant comes from the authenticated context and from nowhere else.** No request shape may
   contain an organization identifier in any position — path, query or body — **and a route
   declaring one is refused AT REGISTRATION rather than at authorization.**
3. **Never manifest-declarable.** No App, SDK caller or AI principal may declare a route here.
4. **No wildcard permission**, and an unrecognised route id fails closed (`0007` rule 3).
5. **Every route evaluates a permission.** There is no unauthenticated member of this class — the
   distinction from `0021`, and why this is a fifth class rather than a widening of the third.

### 3c. Audit, and the bound this class does not inherit

**Every mutating route writes an audit record into the tenant's own `audit_event`** — the same table
`0028`'s platform-originated records land in, so a tenant reading their trail sees what they did and
what the platform did in one place.

**Reads are not universally audited, and that is a DIFFERENCE FROM P4 stated rather than inherited.**
P4 audits platform reads because the actor is outside the tenant and enumeration is reconnaissance.
**Here the actor is a member reading their own data**, and a write per settings page view costs the
tenant's own allowance for no detection value. **Sensitive reads are audited individually, per route.**

> **⚠ THE CONSEQUENCE: THIS CLASS HAS NO EQUIVALENT OF P4'S ACCIDENTAL READ BOUND.** P4 makes every
> platform read a write, so the write ceiling bounds read cost — which `0042` recorded as
> load-bearing-by-accident. **Here it does not. Every read shape needs its OWN bound — a page cap or
> an index — and `freeTierImpact` must say which.** Invitations, sessions and usage are the three
> with unbounded shapes, and they are the same three `§6a` flagged.

**AND THE FAILURE MODE MOVES RATHER THAN DISAPPEARING — `qa-agent`, and it is the reason this clause
is normative rather than advisory:**

> **Under P4 an unbounded read was ACCIDENTALLY safe. Under this class an unbounded read is SIMPLY
> UNBOUNDED** — and invitations, sessions and usage are exactly the shapes where a page cap is easy
> to forget, **because none of them feels like a list.**

**RULED: every read shape in this class declares a page cap or names the index that bounds it. An
absent bound is a REGISTRATION FAILURE, never a fallback.**

> **A DEFAULT PAGE SIZE IS THE FAIL-OPEN VERSION OF THIS, and it will be proposed as a convenience.**
> A route that forgot its bound and a route that accepted the default are indistinguishable
> afterwards — which is `architecture.md` §3a-i's shape: **key the requirement on the exception, so
> the unstated case is caught by the default rather than absorbed by it.**

**And note why this must be caught here rather than in review:** `security-agent` found the platform
version of this (SR-15) by reviewing a built surface. **Designing it out means the review that would
have caught it does not happen** — so the registration check is the only thing standing where the
review used to.

### 3d. A route may declare a CONJUNCTION of permissions. Never a disjunction. — TEAM LEAD RULING

**The caller must hold all of them, evaluated in Core on every call.**

`PlatformRoutePermission` is one permission per route, and that constraint is what made
`core.template-adoption.read` a separate NAME rather than a co-holding requirement. **That is a
property of a registry that already shipped; it does not have to be a property of one being written
now.**

> **`A ∧ B` is strictly MORE restrictive than either conjunct — enumerable, statically checkable,
> and it cannot widen reach. `A ∨ B` IS A WIDENING WEARING THE SAME SYNTAX.**

**Refuse the disjunction AT THE TYPE LEVEL so it cannot be expressed**, never in a comment. It
arrives as convenience the first time a route is awkward to grant, and **a prohibition a type
enforces cannot be argued with at 3am.**

**The reachability assertion goes one arity up — per conjunct, not per route.** A route whose
conjunction no role can satisfy is refused to every caller alive, **and a conjunction makes that
defect easier to create by accident.**

**Which instrument to use:** *would a grantor ever want to grant the capability WITHOUT one of the
conjuncts?* **Yes → its own permission**, and a conjunction would be a name nobody can grant.
**No → the conjunction says the true thing** and a third name is a synonym.

**AND THIS IS WHAT MAKES `security.md` §2a ENFORCEABLE UNDER `0007` D16.** Under a closed role set,
co-holding was a property of tables anyone could read. **Under D16's custom roles it is a property of
nothing — constraint 1 permits any subset, so a tenant admin holding both may mint a role holding
one.** The conjunction moves the test from *"every role holding A happens to hold B"* to **`A ∧ B`
decided on every call, which no custom role can decompose.** Recorded in `security.md` §2a-0.

## 4. What this does not decide

- **The route table, the registry file and the dispatcher branch** — Core's, sequenced after this.
- **The role model** — `0043`. **This class is orthogonal: it decides where tenant-admin routes
  live, not who may call them.**
- **`OI-1` is closed by a route in this class being built, NOT by this record.** Until then it stays
  open and must not be reported otherwise.
