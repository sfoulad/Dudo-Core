# `platform/admin` — Dudo platform-administration console

The operator console for **`https://admin.dudo.work`** (ADR 0010, ADR 0022).

**This is the shell only.** Project setup, sign-in, layout, routing and honest empty states.
The platform features — Organizations, Templates, Operators, Audit — are **not built**, and
each section says so on screen rather than showing a placeholder table.

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
npm run verify       # typecheck + the KDF and cross-client drift checks
```

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

## Session state: what this console knows, and what it cannot

**It cannot confirm that a session is still live**, and it says so in the header rather than
guessing. The reason is structural: every Action requires a tenant, an operator can never have
one, and the route that would answer the question — `platform.session.whoami` in
`platform-operator-v1` — is in a contract that is still **proposed**.

`src/api/platform-session.ts` holds that gap, the reasoning, and the exact steps for closing it
when the contract is accepted. Nothing in this console calls an unratified route.

This costs nothing in safety: whatever the console believes changes no authorization outcome.
Core authorizes every platform route on every call, and ADR 0010 §7 is explicit —
**hiding a menu or a button is never an authorization control.**

## Layout

```
src/
  api/
    kdf.ts kdf-client.ts kdf-worker.ts   copies of platform/web's, drift-checked
    auth.ts                              sign-in and sign-out against login-v1
    config.ts                            build config; refuses a cross-origin API
    errors.ts                            the shared error envelope, console wording
    platform-session.ts                  THE SEAM: why a session cannot be verified
  components/
    AdminShell.tsx                       header, sidebar, main; drawer below lg
    NotBuiltYet.tsx                      the honest empty state
    ui/button.tsx ui/field.tsx           shadcn copy-in source
  lib/
    router.ts                            ~80-line hash router; see the file for why
    use-session.ts                       the operator session state machine
    cn.ts
  screens/
    SignIn.tsx                           sign-in with measured KDF progress
    Organizations.tsx Templates.tsx Operators.tsx Audit.tsx
scripts/verify-kdf.mjs                   normative checks + the drift check
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
