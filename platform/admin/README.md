# `platform/admin` — Dudo platform-administration console

The operator console for **`https://admin.dudo.work`** (ADR 0010, ADR 0022).

**Organizations (including onboarding) and Templates are live. Operators and Audit are not.**
Sign-in, the session probe, the Organization list, onboarding a business and the full Template
surface call real, accepted, audited platform routes. The other two sections say what they are
waiting for rather than showing a placeholder table.

> ### Templates are complete and inert, and the screen says so
>
> `template-v1` **TM-4**: *"Nothing consumes a Template. Organizations have no `template_id`, so
> this capability is COMPLETE AND INERT. Creating a business type changes what no user sees
> until onboarding adds the reference. It must not be reported as 'business types now work'."*
>
> So the Templates screen carries a permanent, non-dismissible notice above its controls saying
> that creating a business type changes nothing a customer sees yet, and naming what will change
> it (onboarding). **This is a third state** — not "blocked on acceptance", not "accepted but
> unimplemented", but **built, working, and connected to nothing.**

It is a sibling of `platform/web` and shares no build, no `package.json`, no session and no
`node_modules` with it.

## Who this is for, and what they cannot do

A **platform operator** is an ordinary principal with a row in `platform_operator`
(ADR 0025) and **zero membership rows** (ADR 0024). That absence is the isolation:

> no membership → no Organization selection → no `TenantStoreResolver` handle → no rows.

**An operator is structurally incapable of reading customer data**, and this console is built
on that assumption throughout. It never calls an Organization-selection route, never expects a
tenant, and has no Organization picker. There is nothing to pick.

## Running it

```
npm install
npm run dev          # http://127.0.0.1:5174
npm run typecheck    # tsc --noEmit
npm run build        # typecheck, then a production build into dist/
npm run verify       # typecheck -> KDF -> platform client -> build -> CSS cascade
npm run verify:kdf       # 56 checks, including byte-identity with platform/web
npm run verify:platform  # 178 checks against the shapes Core actually returns
npm run verify:css       # 10 checks against the BUILT stylesheet (needs a build first)
```

`verify` runs the build before `verify:css` on purpose, so the artifact being checked can
never be a stale one.

### Why there is a CSS check at all

**Three navigation defects have now shipped where the markup was correct and the artifact was
wrong**, and on two of them every check in this repository passed:

| Defect | Why the source looked right |
|---|---|
| `inset-block-0` | Not a Tailwind utility. Compiled to **nothing**; the drawer lost its vertical bounds. |
| `lg:` vs `ltr:` | Both classes emitted. The `lg:` one **lost the cascade** — a media query adds no specificity, and the later same-weight rule wins. Sidebar invisible on desktop. |
| `inset-y-0` on the drawer | Valid, emitted, applied — and pinned the drawer to `0` **under the `z-30` sticky header**, hiding the first nav row. |

So `verify:css` asserts **outcomes against the built stylesheet**: that no `ltr:`/`rtl:` rule
overrides a breakpoint-scoped one, that the drawer's off-screen transform is confined to small
screens, that every class used in `src/` actually produced a rule, and that the drawer's top
offset tracks `--dudo-header-height` rather than zero.

**It is not a substitute for looking at the page.** There is no browser available here and none
may be installed, so it checks geometry it can compute, not geometry as rendered. **A visual
check at a single width would have passed two of the three defects above** — a sidebar that is
absent and a menu missing only its first row both look unremarkable.

## The two live routes

| Route | What it does |
|---|---|
| `GET /api/v1/platform/whoami` | The session probe. Returns the operator's own principal id, platform role and reachable permissions. |
| `GET /api/v1/platform/organizations` | The Organization list. Identifiers, status and creation date, keyset-paginated. |
| `GET /api/v1/platform/templates` | The Template list, keyset-paginated. |
| `GET /api/v1/platform/templates/{template_id}` | One Template. **The first route in this class with a path parameter.** |
| `POST /api/v1/platform/templates` | Create a Template. Sends `name` and optionally `level_labels`. |
| `POST /api/v1/platform/organizations` | **Onboard a business.** Creates the Organization, its first admin, that admin's credential and one `owner` membership. |
| `GET /api/v1/platform/organizations/{id}` | **Organization detail.** Everything the page needs in one request — the Template is embedded. |
| `POST /api/v1/platform/organizations/{id}/members/resolve` | **Resolve one member** by an identifier the operator already holds. |

### The collapsed refusal, and how this console avoids rebuilding the oracle

`platform.organizations.members.resolve` returns **one argument-free 404 for five conditions** —
unknown Organization, identifier belonging to nobody, identifier belonging to a non-member,
suspended membership, and **the principal is a platform operator**. The fifth is the one that
matters: without it the route is an oracle for who holds platform authority.

**Core enforces that. `OrganizationDetail.tsx` could destroy it, and is written so it cannot:**

- **One refusal string** — a module constant, no parameters, no interpolation, referenced once.
- **One code path, one visual state.** Every `404` produces `{ kind: 'refused' }`, which
  **carries no payload** — no error, no request id, no `details`. Nothing downstream can branch on
  the cause because nothing downstream has it. That is enforced by the type.
- **No logging anywhere on the screen**, on any branch.
- **One request either way**, so a hit and a miss take the same round trip.

`verify:platform` asserts all of this **structurally against the source**, including that a `404`
carrying `details` naming the cause still produces the identical outcome. Negative-controlled: a
`console.log` of `error.details` on the refusal path makes two checks fail.

**`forbidden` is deliberately distinct.** The resolve declares `core.credential.reset`, so a
revoked grant closes the lookup entirely — rendering that as "found nothing" would invite endless
re-probing, each attempt writing into a customer's audit log.

**One local decision, stated because it is the only one:** a malformed identifier is refused before
submitting. That separates well-formed from malformed — a fact the operator already holds — and
cannot separate any two of the five cases, since all five need a well-formed identifier to reach
Core. It also spares a customer's log an audit record for a typo.

> **The ASCII restriction is the contract's, not this console's.** Dudo has never accepted
> non-ASCII identifiers: `0015` §D, `login-v1`, and both platform schemas carry the
> machine-readable pattern `^[\x21-\x7E]*@[\x21-\x7E]*$`. This console is **enforcing** a stated
> restriction, not narrowing one — the gap is in Core, where two call sites do not yet apply it,
> and it is being closed there. **Do not remove this check, and do not widen it if Core is ever
> observed accepting something it refuses.** A client that submits what the contract forbids is
> broken whether or not the server catches it.
>
> **The local refusal is still rendered differently from the server one**, and that requirement
> survives the correction unchanged: a refusal produced *here* means the address was never sent,
> and an operator who read that as "no match" would tell a customer something false.

### There is no member list, and it is not missing

**No route in Dudo returns member identities.** `member_count` is a count and renders as one — no
roster, no "view all members", no pagination toward one, no empty table. A count does not invert; a
list across every Organization an operator can already enumerate would reconstruct every person's
membership, which `core-object-registry.yaml` CO1 forbids by name. **If the page looks like it is
missing a list, that is the correct appearance.**

**Every resolve writes a tenant-side audit record into the customer's own log, including
refusals** — the probe is what is recorded, not the answer.

> **The record is written and the customer cannot yet read it.** `0028`'s amendment of 2026-09-05
> strikes "tenant-visible" from its own residual: `core.audit.read` is catalogued at organization
> scope and **has no route**, so this surface is *auditable rather than audited* — the evidence is
> captured and the party it protects cannot see it. **The screen therefore says "recorded in", not
> "visible to".** It said the latter, which was false, and the amendment warns specifically against
> citing `0028` for a control that has never worked.
>
> The discipline matters more for it, not less: the records are permanent and become readable when
> the tenant-side route lands, so every speculative call made today is a line in a customer's log
> they will eventually read.

So the resolve fires on explicit submit only: no lookup-as-you-type, no debounce, no prefetch, no
retry-on-blur, no automatic retry. **And the detail read is never polled** — at 2 row-writes a
call, a thirty-second refresh loop exhausts an operator's daily ceiling in about two and a half
hours and then answers 503.

### Onboarding: this browser holds the only copy of the password

`0026` option B — **the console generates the password and derives from it**, and
`onboardOrganizationOutput` carries **no credential field of any kind**. Core stores a verifier it
cannot invert, so if this screen loses the value the account is unreachable and the only remedy is
a credential reset.

- 24 CSPRNG bytes, base64url, 32 characters, ~192 bits — matching `seed-principal.ts` exactly.
  The generator lives in its own module (`api/generate-password.ts`) **so the real function can be
  imported by a shared suite**; `onboarding-credential.ts` imports the Web Worker and cannot be.

  > **`api/generate-password.ts` carries the only explicit `.ts` import extension in `src/`, and
  > it is load-bearing.** Splitting the module out was not sufficient: a **bare Node loader** — one
  > without this project's `scripts/node-resolve-*.mjs` hooks — cannot resolve an extensionless
  > relative import, so `packages/testing` could not import it and was generating passwords in a
  > fixture instead. `0017` records that the pre-auth rate limiter "does not bind across isolates,
  > so the entropy of this string is what is actually protecting the account" — **the generator is
  > the control**, and it was the one leg of the credential path with no shared assertion.
  >
  > **The rest of the tree must stay extensionless.** `api/kdf-client.ts` and `api/kdf-worker.ts`
  > are byte-identical copies of `platform/web`'s and are compared character for character;
  > converting them would break the cross-client drift check to suit a test harness. The mixed
  > style is forced, not careless. `allowImportingTsExtensions` is enabled for this one import —
  > legal because `noEmit` is true, and permissive rather than mandatory.
  >
  > **What a bare loader can and cannot reach:** `kdf.ts` ✓ (imports nothing) ·
  > `generate-password.ts` ✓ (explicit extension) · `kdf-client.ts`, `onboarding-credential.ts`,
  > `platform.ts` ✗ — extensionless, and `kdf-client.ts` can never change.
- The derivation is **`deriveLogin` — the same code path a person signing in uses.** It is called,
  not reimplemented: if onboarding derived differently from login, the account would be created and
  could never be signed into, and the failure would appear only when a real customer first tried.
- **The password is not rendered until Core answers 201.** Showing it beside a request that then
  failed hands an operator a credential for an account that does not exist.
- Never persisted, never logged, never in a URL. Dismissing the panel takes a deliberate
  confirmation, because a mis-click there destroys the only copy.
- The screen states `0026`'s accepted cost plainly: **there is no self-service password change**,
  so whoever onboards a business knows that admin's password until an operator resets it.

**The Workspace name is not asked for.** `first_workspace_name` is required by the contract,
validated by Core, and **discarded** — `business` has exactly two columns and naming belongs to the
organization-structure slice. The client sends a fixed, self-describing placeholder and the screen
explains the absence where an operator would look for the field. **Accepting and discarding is
worse than not accepting:** an operator who types "Main Campus" and watches it vanish has been lied
to by the form, and nothing is preserved for later.

**A `201` with warnings is a success, not a failure.** `workspace_id: null` plus
`first_workspace_not_created` means the Organization, the admin and the credential all exist and a
tenant-side write did not. It is rendered prominently and **not** as an error — treating it as one
would make an operator discard a live credential for a real customer.

**Two things about `create` that are easy to get wrong, and are asserted in `verify:platform`:**

- **A blank label is omitted, never sent as `""`.** Core refuses a zero-length label with
  `out_of_range`, so sending an empty string for "leave it default" turns a blank field into a
  validation error. **Omission is what selects the default**, and the client never applies the
  default itself — Core always returns all three labels, which is what stops the web and Apple
  clients drifting into different ideas of what an unlabelled level is called.
- **Any `2xx` is success.** This client accepts 200 and 201 alike, and that is now belt-and-braces
  rather than a workaround. **It was a real divergence and it has been fixed:** `template-v1`
  declared `successStatus: 201` while `http/api.ts` hardcoded 200 for every platform route.
  `core-agent` added `successStatus` to `PlatformRoute` and `api.ts` now honours it, so Core
  returns **201** for both `templates.create` and `organizations.create`. Accepting either still
  costs nothing and means this client cannot break on a status change alone.

**And one about errors:** `rate_limited` and `quota_exceeded` **share HTTP 429**
(`kernel/errors.ts`), so the status cannot tell them apart. The client reads the **code from the
envelope body** and falls back to the status only when the body is unreadable. Mislabelling a
quota refusal as a rate limit would tell an operator to wait a moment when waiting cannot help.

**The success body is the response — there is no envelope.** `data` and `next_cursor` are
top-level keys. This was read off the implementation (`platform-routes.ts` ends with
`ok(outcome.value.body)`, `http/api.ts:364` hands it to `renderSuccess`, `http/response.ts:102`
is a bare `JSON.stringify`) rather than assumed from the schema, and `verify:platform` asserts
that an **enveloped body is refused** rather than silently misread.

**Every call on this class writes an audit record — including the reads.** So this console
**never polls**: no interval, no refetch on focus, no refetch on reconnect, no speculative
prefetch, and no automatic retry. The probe runs once per page load and on a button. A
`whoami` on a timer would fill the log that exists to record what operators *did*.

**These routes 404 on `app.dudo.work` and `api.dudo.work`** by construction — `http/api.ts`
binds the class to an admin host list and answers the same `404` for "wrong host" and "class
not composed", so a caller cannot tell them apart. Verified in `workerd`, including a caller
holding a **valid operator session still getting `404` on the wrong host**.

> ### Do not test host-dependent behaviour through `wrangler dev`
>
> When a `custom_domain` route is configured, **`wrangler dev` overwrites the caller's `Host`
> header before the Worker runs.** Five `curl`s with five different `Host` values all arrive as
> the same host, so the 404-on-the-wrong-host behaviour above **cannot be observed that way** —
> and the result looks like a defect that is not there. One was reported and disproved with a
> probe Worker that echoes what the Worker actually sees. Use `workerd` directly, or a probe
> Worker, for anything that depends on the host.

### There is no fixture or demo mode, deliberately

`platform/web` has a `fixture` transport that answers its own requests. **This console does
not**, and will not. ADR 0010's adoption audit removed fake APIs and placeholder data with the
reason stated in full:

> Dudo shows Core-backed truth only. **Fabricated data in an admin console is worse than no
> data — an operator cannot tell it from real.**

**The consequence is real and accepted:** `npm run dev` on its own renders the sign-in screen
and then fails honestly, because nothing is serving `/auth/login/complete` on
`127.0.0.1:5174`. To exercise sign-in you need Core running **on the same origin** — not on a
different port. See the next section for why a different port cannot work.

What *is* exercisable without a server is the client's reading of Core: `npm run verify:platform`
drives the real `platform.ts` through an injected `fetch` against the exact shapes Core emits,
including the failure envelopes. That is a shape check, not a substitute for a live run.

**Sign-in has still never run against a live Core.** It is honest to say the KDF is verified and
the sign-in path is not.

### The API must be same-origin. This is not a preference.

The session credential is a cookie Core sets with `HttpOnly; Secure; SameSite=Lax; Path=/` and
**no `Domain` attribute**, and Core sets no CORS credential headers. A cookie with no `Domain`
goes only to the exact host that set it. A build pointed at another origin would appear to sign
in and then be refused on every call afterwards, with nothing in the UI to say why.

`src/api/config.ts` therefore **throws at module load** on a cross-origin
`VITE_DUDO_ADMIN_API_BASE_URL`, and `src/main.tsx` renders that error rather than leaving a
white page. ADR 0022 considered and rejected both ways around it — broadening the cookie with
`Domain=dudo.work`, and CORS with credentials. Neither is a client flag to override.

### Build-time variables

All are optional, all are embedded in the public bundle, and **none may ever hold a secret.**

| Variable | Default | Meaning |
|---|---|---|
| `VITE_DUDO_ADMIN_API_BASE_URL` | `''` (same origin) | An origin. A cross-origin value is refused at load. |
| `VITE_DUDO_ADMIN_API_TIMEOUT_MS` | `20000` | Clamped to 1,000–120,000. Sign-in uses at least 30,000. |
| `VITE_DUDO_ADMIN_BUILD_LABEL` | `unlabelled build` | Shown in the header. **Not a version number.** |

They are prefixed `VITE_DUDO_ADMIN_` rather than `VITE_DUDO_` so a `.env` meant for
`platform/web` cannot silently configure this console.

## The key derivation is a copy, and drift is checked mechanically

`src/api/kdf.ts`, `kdf-client.ts` and `kdf-worker.ts` are **deliberate copies** of
`platform/web`'s. They are copied rather than imported because the two clients are separately
owned (`.claude/rules/architecture.md` §2) and a relative import across that boundary would be
a source dependency between two independently deployed applications.

**A copy kept in step by a comment is a copy that drifts.** So `npm run verify:kdf` reads the
web client's files and compares them character for character — `kdf.ts` from its
`Normative constants` banner onwards, the other two in full — and **fails** if either side was
edited without the other.

The derivation is a **four-implementation contract**: this console, `platform/web`,
`Dudo-Apple` in Swift, and `platform/core/identity/credential-store.ts`. If they do not produce
byte-identical output, a person who enrols on one client cannot sign in on another. Changing it
is a contract change that goes to the Team Lead and lands in all four — never a local edit.

## Session state: four answers, and the one that must not become a loop

The shell could not confirm a session was live and shipped an honest "Session not verified"
banner. `platform.session.whoami` is now accepted and implemented, so **the banner is gone
because it was answered**, not because it got annoying. The probe returns one of four things:

| Probe result | Console state | Why |
|---|---|---|
| `200` | signed in | Verified, and the caller is an operator. |
| `401` | sign-in screen | No usable credential. |
| `403` | **its own screen** | Signed in, and refused by the platform class. |
| anything else | loading + retry | An unreachable server says nothing about a session. |

**A `403` is not a `401`, and rendering it as one builds an infinite loop** — the person would
sign in successfully and be refused again, forever, with the form implying their password was
wrong. `0021` documents the same shape for the Organization picker.

**And the console never says *why* it was refused.** `platform-operator-v1` collapses four
conditions into one argument-free `forbidden` — no `platform_operator` row, an unrecognised
role, a role lacking the permission, or **a principal present in both tables** — because a
caller who could tell them apart could use these routes to probe `organization_membership`. A
friendly "you are not a platform operator" would be unsupported, and on the fourth condition
actively wrong.

None of this is a security boundary. Core authorizes every platform route on every call, and
ADR 0010 §7 is explicit — **hiding a menu or a button is never an authorization control.** The
permission list `whoami` returns is for rendering only and nothing branches on it.

## Layout

```
src/
  api/
    kdf.ts kdf-client.ts kdf-worker.ts   copies of platform/web's, drift-checked
    auth.ts                              sign-in and sign-out against login-v1
    platform.ts                          the platform route class; parses, never casts
    platform-session.ts                  the probe, and its four answers
    generate-password.ts                 24 CSPRNG bytes; split out so it is testable
    onboarding-credential.ts             generates and derives; the server sees neither
    config.ts                            build config; refuses a cross-origin API
    errors.ts                            the shared error envelope, console wording
  components/
    AdminShell.tsx                       header, sidebar, main; drawer below lg
    StateBlock.tsx                       loading / error / empty, drawn once
    NotBuiltYet.tsx                      the honest "not built" state
    ui/button.tsx ui/field.tsx           shadcn copy-in source
  lib/
    router.ts                            ~80-line hash router; see the file for why
    use-session.ts                       the operator session state machine
    cn.ts
  screens/
    SignIn.tsx                           sign-in with measured KDF progress
    Organizations.tsx                    LIVE — the Organization list, with onboarding above it
    OrganizationDetail.tsx               LIVE — one Organization; the collapsed-refusal lookup
    OnboardOrganization.tsx              LIVE — the form and the shown-once credential panel
    Templates.tsx                        LIVE — list and create; carries the TM-4 notice
    Operators.tsx Audit.tsx              not built; each says what it waits for
scripts/verify-kdf.mjs                   normative checks + the cross-client drift check
scripts/verify-platform.mjs              the platform client against Core's real shapes
scripts/node-resolve-*.mjs               dev-only ESM hooks so the scripts import real modules
```

## Accessibility and internationalisation

Part of the definition of done, not a follow-up (ADR 0010).

- **Logical properties only** — `ps`/`pe`, `ms`/`me`, `border-e`, `start-0`, `text-start`.
  Never `left`/`right`. Arabic is then a `dir` attribute rather than a rewrite.
- A skip link, a real `<nav aria-label>`, `aria-current="page"` on the open section, a focus
  ring that is never removed and is redrawn in gold on navy so it survives the dark chrome.
- The drawer traps nothing but moves focus in on open and back to its button on close, and
  closes on `Escape`.
- The sign-in progress bar is a real `role="progressbar"` with a polite live region, and its
  remaining-time figure is labelled an estimate because that is what it is.

**Not yet done:** no RTL screenshot pass, no screen-reader pass, no automated axe run. Recorded
as owed rather than claimed.
