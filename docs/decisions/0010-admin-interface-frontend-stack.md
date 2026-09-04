# 0010 — Admin interface: frontend stack and shadcn-admin adoption

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** **User** (explicit written decision, 2026-09-01), Dudo Team Lead
- **Owning agent:** Team Lead records. Implementation will be `web-agent`.

> **No implementation is authorised by this record.** No dependency is installed, no code
> is written, nothing is deployed. This records the decision, the adoption audit, the
> placement, the security boundaries and the testing plan — as the user required — so that
> implementation, when approved, builds against something reviewed.

## Context

`0003` approved TypeScript on Cloudflare and stated explicitly that this was **not**
approval of any npm package, framework, or ORM. `0006` decided tenancy. `0008` bound the
project to USD 0 / BD 0 per month. No frontend framework had been chosen, and
`platform/web/` holds nothing but a README.

Dudo needs a platform-administration interface at **`https://admin.dudo.work`**.

## Decision

### 1. Domain

**`https://admin.dudo.work`** is the **Dudo platform-administration interface.**

### 2. Approved frontend stack

React · TypeScript · Vite · **Tailwind CSS v4** · shadcn/Radix UI components ·
**TanStack Router, Query and Table — only where actually required.**

"Only where actually required" is a constraint, not a preference. A TanStack package that
earns its place stays; one adopted because the template had it does not.

### 3. Foundation

The open-source **shadcn-admin** project is adopted as the visual and component
foundation.

| | |
|---|---|
| Upstream | `github.com/satnaing/shadcn-admin` |
| **Revision adopted** | **`e16c87f213a5ba5e45964e9b67c792105ec74d26`** |
| Commit date | 2026-06-11 |
| **Licence** | **MIT** |

**All required MIT notices are preserved.** The upstream `LICENSE` is retained, with
attribution to the upstream author recorded in the adopting directory. MIT permits
modification and redistribution provided the copyright and permission notice survive; they
will.

**This is not a clone.** The adoption audit below governs what is taken.

## Adoption audit

Performed against the pinned revision, 2026-09-01.

**70 packages: 43 runtime, 27 development.**

### Removed — mandated by the user, and each for a specific reason

| Item | Why |
|---|---|
| **`@clerk/react`** and all template authentication logic | **Dudo Core is the sole authority for authentication.** A third-party auth SDK in the admin client would put identity outside Core, which contradicts `AUTHORIZATION_STANDARD.md` and §7 below. |
| **`netlify.toml`** | Deployment is Cloudflare under `0003`; Netlify configuration is dead weight that invites a second deployment path. |
| **`.env.example`** | Template sample credentials. `SECURITY.md` and `0002` forbid credential material in a public repository, including examples that get copied. |
| **`@faker-js/faker`**, demo users, fake APIs, placeholder data | Dudo shows **Core-backed truth only**. Fabricated data in an admin console is worse than no data — an operator cannot tell it from real. |
| Unused features: `chats`, `tasks`, and template `apps`/`users` demo screens | Not in the §11 shell. Retaining them means retaining their dependencies and their fake data. |

Upstream ships eight feature areas — `apps`, `auth`, `chats`, `dashboard`, `errors`,
`settings`, `tasks`, `users`. **Dudo needs the shell in §11 and nothing else.** Anything
retained is retained deliberately.

### Dependencies to scrutinise before install

| Package | Question |
|---|---|
| `axios` | The platform runs on `fetch`. A second HTTP client is a second place for auth headers and error handling to diverge. **Prefer `fetch`.** |
| `recharts` | Only if the dashboard genuinely charts something. Not for decoration. |
| `zustand` | Only if TanStack Query does not already cover the state involved. |
| `@tanstack/react-router` · `react-table` | Router and Table are likely required for the shell; **Query, Router and Table each justify themselves separately.** |
| `date-fns`, `cmdk`, `input-otp`, `react-day-picker`, `sonner`, `react-top-loading-bar` | Each retained only if a §11 screen uses it. |

### Licence and attribution obligations

- **shadcn-admin — MIT.** Preserve the copyright and permission notice.
- **shadcn/ui — MIT.** Components are copied into the codebase by design; attribution
  preserved.
- **Radix UI, TanStack, Tailwind CSS, React — MIT.** Permissive, compatible.
- **Every retained dependency must be verified free and open-source before install**, with
  its licence recorded. **A package whose licence cannot be verified is not installed.**

**This audit is not a substitute for reading the licence of each retained package at
install time.** It records the obligations known now, at the pinned revision.

## Directory placement

**Proposed: `platform/admin/`**, a sibling of `platform/web/`.

Reasoning, and the alternative rejected:

- `apps/` is **reserved for installable business Apps** (`0004`). The admin console is not
  an installable App and must not go there.
- `platform/web/` is the **customer-facing responsive web application**. The admin console
  serves **platform operators**, a different audience with a different threat model.
- Putting them in one directory invites shared components that leak platform-operator
  affordances into the customer client. **A separate directory makes that leak a visible
  cross-boundary import rather than an accident.**

**This requires an amendment to `0004`'s ownership table**, which currently names only
`platform/core/`, `platform/web/` and `platform/capabilities/`. Recorded as an open item
below rather than assumed.

## Security boundaries

**`0010` changes no authorization behaviour whatsoever.** Restated because a UI project is
exactly where this gets eroded:

**Dudo Core remains the sole authority for** authentication · authorization · roles and
permissions · tenant and Organization scope · platform-administrator access · audit
logging.

> **Hiding a menu or a button in the web interface is never an authorization control.**

Consequences that bind the implementation:

1. Every admin action is authorised **server-side in Core, on every call**, exactly as any
   other caller. The console is a client and is trusted with nothing.
2. The console **holds no permission logic**. It may *render* according to permissions Core
   reports; it may never *decide* them.
3. **Platform administrators and Organization/customer administrators are not mixed**
   without an explicit architecture decision. `admin.dudo.work` is the **platform**
   administration interface. A customer-facing administration surface, if one is ever
   built, is a separate decision — and the two must not share a session, a role space, or a
   permission namespace by default.
4. Platform-scope access remains as narrowed by the CRIT-2 fix: `platform-admin` holds
   exactly the two platform-scoped permissions and **cannot read tenant business data**
   until the AZ3 break-glass record exists. **The admin console does not change that, and
   must not be built assuming it will.**
5. Every sensitive action the console triggers leaves an **audit record in Core**.

## Internationalisation — Arabic and English are first-class

- Full **RTL and LTR** layouts, not an RTL afterthought.
- **Logical Tailwind properties** — `start`/`end`, never `left`/`right`.
- Tables, dialogs, navigation, pagination and forms tested in **both directions**.
- **No English strings embedded directly inside reusable components.**

Arabic is not a localisation task appended at the end; a component written with `left`/
`right` has to be rewritten, not translated.

## Design tokens

Dudo's own tokens replace the template brand entirely: colours and logo · typography ·
spacing · radius · shadows · light and dark themes · focus, error, warning and success
states.

Retaining the template's brand would ship someone else's identity, and the template's
tokens are not accessibility-checked against Dudo's palette.

## Initial scope — an admin shell only

Secure sign-in · responsive navigation · dashboard · Organizations · users and memberships ·
Apps and capabilities · permissions · audit log · **system health and free-tier usage**.

The last one is directly useful: `0008` requires the free-tier thresholds be watched, and
`free-tier-register.md` currently has no surface at all.

## Testing plan

- **RTL/LTR** for every screen — the two directions are separate test cases.
- **Authorization negative tests:** the console must fail correctly when Core refuses. A
  hidden control is not a passing test; the test is that the **API call is rejected**.
- **No-fabricated-data assertion:** no screen renders a value Core did not supply.
- Accessibility: keyboard navigation, focus visibility, Dynamic Type equivalence, contrast
  in both themes.
- Empty, loading, offline and error states for every data surface.
- Test framework remains **`TS1`, undecided.** This plan does not choose one.

## Impact on the Phase 0 Foundation Gate

**None. Deliberately none.**

- This record is on a **separate branch** and is **not folded into the frozen Foundation
  Gate repair commit**, per the user's instruction.
- The Phase 0 branch head stays frozen at `685b99e` for its CodeRabbit review.
- **No Phase 0 gate condition changes.** C1–C6 are unaffected: nothing is installed,
  nothing is deployed, and projected cost stays USD 0.
- **Implementation is Phase 1 work** and is blocked behind Phase 0 approval.

## Cost

Nothing here costs money **yet**, and two things must be checked before anything does:

- Every dependency is free and open-source — **verify at install**, per `0008`.
- **Hosting `admin.dudo.work` is not yet approved.** It would need Cloudflare Workers or
  Pages and a custom domain. Workers Free allows 100,000 requests/day; a custom domain on a
  Cloudflare-managed zone is free. **Neither is approved by this record** — deployment
  needs its own decision under `0008`.

## Approval

The user decided this in writing on 2026-09-01, including the domain, the stack, the
adoption of shadcn-admin with its revision and MIT notices recorded, the removal list, the
Core-authority boundary, the platform/customer administrator separation, RTL/LTR
requirements, Dudo design tokens, the initial shell scope, and the explicit instruction not
to deploy, install, or implement yet.

## Open, and not decided here

1. **`0004` ownership amendment** for `platform/admin/` — needs a record.
2. **Deployment of `admin.dudo.work`** — hosting, domain configuration, and its free-tier
   impact.
3. **`TS1`** — the test framework, still undecided.
4. **A customer-facing administration surface**, if ever needed — explicitly a separate
   architecture decision (§7 point 3).
5. **Final retained-dependency list** — the audit above narrows it; the exact set is fixed
   at implementation and each licence verified then.
