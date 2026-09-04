# platform/web/ — Responsive web application

**Owner: `web-agent`** (see `docs/architecture/boundaries.md`)

The browser client for Dudo, across desktop, tablet, and phone widths.

The native Apple application is **not** here — it lives in the separate `Dudo-Apple`
repository and is owned by `app-agent`.

- Consumes contracts from `packages/contracts/**` — the **same** approved set the Apple
  client consumes. Divergence between the two clients is a contract defect, not a local
  workaround.
- **No business rules here** — pricing, tax, entitlement, approvals, workflow
  transitions, permission decisions, and tenant resolution belong to `platform/core/`.
- **No direct data access** — no SQL, ORM models, datastore clients, or connection
  strings.
- Hiding a control is presentation, never security. Assume every request is authorized
  server-side.
- Never authors a contract.
- Responsive behaviour and accessibility are part of done, not follow-up work.

Boundaries: `docs/architecture/boundaries.md` · Delivery:
`docs/product/mvp-delivery-policy.md` · Contributing: `CONTRIBUTING.md`

---

## Stack

**React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui**, built to static assets
and served by Cloudflare Workers Static Assets — `docs/decisions/0016-web-application-stack.md`.

The reason shapes how this is built, so it is repeated here rather than left in the ADR:
**requests for static assets are free and unlimited.** They do not invoke the Worker,
consume no CPU, and do not count against the 100,000 requests/day allowance. An SPA
therefore preserves the entire Workers allowance for the API, which is the only thing
that genuinely needs the server.

**`run_worker_first` must not be enabled for asset routes.** It converts free, unlimited
asset requests into billed Worker invocations under a daily cap, and past that cap they
return `429` rather than falling back to serving the asset.

### Dependencies, and why each one

Twelve direct packages, 84 in the tree. Every one is a supply-chain surface, so each is
justified:

| Package | Why |
|---|---|
| `react`, `react-dom` | The decision (`0016`) |
| `clsx`, `tailwind-merge` | The `cn()` helper every shadcn/ui component expects, so copy-in components work unmodified and this surface can share components with admin (`0010`) |
| `class-variance-authority` | The variant helper shadcn/ui components are written against |
| `vite`, `@vitejs/plugin-react` | The build (`0016`) |
| `tailwindcss`, `@tailwindcss/vite` | The styling (`0016`) |
| `typescript`, `@types/react`, `@types/react-dom` | The language (`0003`) |

**Deliberately NOT installed**, and each is a decision rather than an omission:

- **No component library as a package.** shadcn/ui is copy-in source — `src/components/ui/`
  is ours to edit. `0016` is explicit about this.
- **No router.** Five routes, and `src/lib/router.ts` is about ninety lines. If admin
  standardises on one, that file is the thing to replace.
- **No Radix.** Native `input`, `textarea` and `select` are already accessible and already
  use the phone's system picker. When a rich combobox is genuinely needed, that is the
  moment to add Radix.
- **No notification library.** `src/components/Toaster.tsx` is about forty lines.
- **No test framework. TS1 is still open** — choosing Vite does not choose Vitest, and
  `qa-agent`'s dependency-free runner stands until TS1 is decided on its own merits.

### RTL

`0010`'s rule applies here and it is not cosmetic: **logical properties only** —
`ps`/`pe`, `ms`/`me`, `start`/`end`, `text-start`, `border-s`/`border-e`. Never
`left`/`right`.

This is **verified, not asserted**: the directory was rendered with `dir="rtl"` and the
whole layout mirrors with no stylesheet change. That pass also found a real bug —
a phone number begins with a neutral `+`, so the bidi algorithm reordered
`+973 3901 2244` into `2244 3901 973+`. Contact values now carry `dir="ltr"`.

## What is built

The **Customer Directory**, contract `customer-directory-v1`, plus **sign-in** and a
**real HTTP transport**. Six screens:

| Screen | Address | Actions used |
|---|---|---|
| Sign in | shown by `AuthGate` when not authenticated | `identity.login.complete` |
| Sign out | header control, when signed in | `identity.session.revoke` |
| Directory | `#/customers` | `ListCustomers`, `SearchCustomers` |
| Record | `#/customers/{id}` | `GetCustomer`, `ArchiveCustomer`, `RestoreCustomer` |
| New customer | `#/customers/new` | `CreateCustomer` |
| Edit customer | `#/customers/{id}/edit` | `GetCustomer`, `UpdateCustomer` |
| Not found | any other address | — |

`MoveCustomerToBusiness` has a client method and no screen. `DeleteCustomer` and
`RestoreDeletedCustomer` have **neither** — they are contracted and deliberately out of
scope for this slice (contract §11.1). They are absent from the `CustomerAction` union,
so calling either is a **compile error** rather than a code-review question.

## Running it

```
cd platform/web
npm install
npm run dev          # http://127.0.0.1:5173
```

Or against the production build:

```
npm run build        # tsc --noEmit && vite build  ->  dist/
npm run preview
```

### Seeing the error states

Nothing fails on its own — a directory that failed at random would teach people to click
through real problems. Faults are injected explicitly from the query string:

```
/?fault=list#/customers
/?fault=detail&faultCode=forbidden#/customers/cus_7Kq2mVx4
/?fault=write#/customers/new
```

`fault` is one of `list`, `detail`, `write`, `all`. `faultCode` is any platform error
code; it defaults to `unavailable`.

**Both switches are fixture-only and are not read in an HTTP build**, because a query
parameter appearing to change how the real API behaves is a lie in the address bar.

### The login screen in a fixture build

The fixture build shows the login screen first, and **the derivation is real** — the
worker, the 600,000 iterations, the measured progress and the 43-character assertion all
run. Only the request is absent, so a reviewer can time a real sign-in on their own device
with no backend. Any submittable address and any non-empty password is accepted; it
authenticates nobody, because there is no server, no session and no principal in that
build. The hint lives in `sessionStorage`, so a reload stays signed in and a new tab does
not.

## Layout

```
index.html                       Vite entry
public/dudo-mark.png             the identity — the scarlet macaw from the app icon
public/favicon-{16,32}.png       browser tab, downscaled from the same 1254 px source
public/apple-touch-icon.png      iOS home screen (180 px)
src/main.tsx                     entry point
src/App.tsx                      route table
src/styles/index.css             Tailwind v4 @theme tokens + the directory table rules
src/lib/                         cn(), hash router, last-list memory
src/contracts/                   contract-derived TYPES, field rules, formatting
src/api/config.ts                transport selection, validated at start-up
src/api/client.ts                the Customer Directory client, transport-agnostic
src/api/fixture-transport.ts     in-memory Core stand-in
src/api/http-transport.ts        the real one, per the contracts' httpBinding
src/api/kdf.ts                   NORMATIVE client-side KDF (ADR 0015 §D)
src/api/kdf-worker.ts            the derivation, off the main thread
src/api/kdf-client.ts            worker lifetime, measured progress, fallback
src/api/auth.ts                  login, logout, session probing, the session hint
src/api/session-signal.ts        the 401 notification
src/lib/use-session.ts           the session state machine (unknown/auth/anon)
src/components/ui/               copy-in shadcn-style primitives
src/components/AuthGate.tsx      login-or-app, and it is presentation only
src/components/                  shell, toaster, state blocks
src/screens/                     the five screens, including Login
scripts/verify-*.mjs             dependency-free verification (see Verifying)
reference/vanilla/               the zero-dependency build (see below)
```

## `reference/vanilla/`

The **zero-dependency build this application replaced**, preserved intact and runnable.
`0016` records it as the fallback if the dependency footprint ever becomes unacceptable,
and a working reference is worth having. Plain HTML, CSS and ES modules; no build step.

```
cd platform/web/reference/vanilla
python3 -m http.server 8931 --bind 127.0.0.1
```

It is **not** part of the Vite build and is excluded from `tsconfig.json`.

## Choosing the transport

Both transports implement one `Transport` interface, so **no screen knows which one it is
talking to** and switching is configuration rather than a code change.

| Variable | Values | Default | Meaning |
|---|---|---|---|
| `VITE_DUDO_TRANSPORT` | `fixture`, `http` | `fixture` | Which transport is constructed |
| `VITE_DUDO_API_BASE_URL` | an origin, or empty | empty (same origin) | Where the Core API is |
| `VITE_DUDO_API_TIMEOUT_MS` | integer 1000–120000 | `20000` | Per-request timeout |

```
npm run dev                                  # fixture, no network
VITE_DUDO_TRANSPORT=http npm run build       # real API, same origin
```

Three rules `src/api/config.ts` enforces at start-up rather than documents:

- **Unset means `fixture`.** A build that was never configured must not reach the network.
- **An unrecognised value is a hard failure.** `VITE_DUDO_TRANSPORT=htpp` throws rather
  than quietly becoming `fixture` — that is the shape of a release everyone believes is
  live and is not.
- **A cross-origin `VITE_DUDO_API_BASE_URL` is refused.** Core issues `dudo_session` with
  `SameSite=Lax` and sets no CORS credential headers, so a cross-origin API receives no
  cookie: login would appear to succeed and every call after it would be refused. Serving
  the app and the API from one origin is a requirement of the session design, not a
  preference. `wrangler.jsonc` already does this.

The header badge reads **Fixture data** or **Live API** from the same value, so a
screenshot says which it is without anyone checking build flags.

Two fixture-only things live in `fixture-transport.ts` and are used only when that
transport is constructed: `FIXTURE_ACTING_PRINCIPAL` (the real `updated_by_principal_id`
is derived server-side) and `FIXTURE_BUSINESSES`.

## Signing in

ADR 0015 §D, option (f): **the browser does the password hashing.** The Workers CPU budget
is 10 ms and cannot fit a real password KDF, so the client derives and the server stores a
hash of what the client sends.

```
POST /auth/login/complete
{ "email": "<normalised>", "derived_key": "<43 base64url characters>" }
```

`derived_key` is `base64url(PBKDF2-SHA256(NFC(password), salt = normalizeIdentifier(email),
600000 iterations, 32 bytes))`. **The raw password never leaves the browser.**

Every parameter is **normative and identical on both clients**. `src/api/kdf.ts` is a
cross-client contract written in code — the same derivation exists in Swift in
`Dudo-Apple` and in `platform/core/identity/credential-store.ts`, and if the three
disagree, nobody can log in.

**Two inputs, two different normalisations, and confusing them is the failure mode:**

| Input | Normalisation |
|---|---|
| email (the salt) | validate ASCII `0x21`–`0x7E`, then **NFKC**, then ASCII-only case fold |
| password | **NFC** only — no case folding, no trimming, no ASCII restriction |

- **Whitespace in an email is rejected, never trimmed.** JS `trim()` and Swift
  `trimmingCharacters(in:.whitespacesAndNewlines)` trim different sets. In a *password*,
  leading and trailing spaces are kept — someone who chose them chose them.
- **Email case folding is ASCII-only, not `toLowerCase()`.** Full Unicode case mapping
  differs between JS and Swift (U+0130 is the usual example). A password is never folded.
- **The password is NFC, never NFKC.** NFKC is a compatibility mapping that folds distinct
  characters onto one (`ﬁ`→`fi`, `²`→`2`), which on a password **destroys entropy the user
  believes they have**. NFC is canonical only: it changes the bytes, never which characters
  were typed. This follows RFC 8265's PRECIS `OpaqueString`, as SCRAM and SASL do.

Swift: `precomposedStringWithCanonicalMapping` for the password,
`precomposedStringWithCompatibilityMapping` for the email. **They are different calls.**

Core never sees a password, so **the NFC rule is one only the clients can keep** — there is
no server-side check that could catch a client skipping it, because the server receives 43
characters either way.

Accepted, recorded cost: an RFC 6531 internationalised address cannot log in. Punycode
domains work.

600,000 iterations is **one to four seconds of local CPU**, so it runs in a Web Worker
(`src/api/kdf-worker.ts`) and the login screen shows progress measured by a real
calibration on the device. True iteration-level progress is impossible — `deriveBits` is
atomic — and the two ways to fake it are both refused, with reasons, in that file.

### Session handling

The session credential is a cookie Core sets `HttpOnly; Secure; SameSite=Lax; Path=/`.
Therefore, on the web:

- **There is no token to store.** The browser holds it; `credentials: 'same-origin'` is
  the whole of session handling.
- **Auth state is probed, not read.** `AuthGate` asks the server, because this client
  cannot see the cookie. `unknown` is a real state and is not rendered as signed-out.
- **Logout revokes and clears.** `POST /auth/session/revoke`, no body, session taken from
  the cookie. `docs/decisions/0018` §B's `cleared` outcome is built: `revokeHandler` returns
  it on all six paths and `collapseTo` is `cleared`, so a `200` **always** carries the
  constant clearing cookie — including when the delete itself failed on budget exhaustion.
  The browser drops the credential regardless.
- **`cleared` means the credential left this browser, not that the row was deleted.** Which
  of the six handler paths ran is what the collapsed response exists to withhold, and this
  client does not guess at it.
- **A logout that was not a `200` is reported, not swallowed.** A network failure or the
  60/minute source rate limit means nothing was revoked and no cookie was cleared — the
  session is still live — so the login screen says so plainly. A screen that implies someone
  is signed out when they are not is the quiet version of the failure §B fixed.
- **`401` means signed out, never "retry".** This survives §B: the clearing cookie removes
  one cause of a stale credential, not the class — 12-hour absolute expiry, revoked
  membership, a suspended principal, or a rotated `SESSION_HMAC_KEY` all still end a session.
  Enforced in three places rather than remembered: `isRetryable` excludes `unauthenticated`,
  `probeSession` maps it to `anonymous` and never `unknown`, and the transport fires
  `onUnauthenticated`.
- **Nothing signs in or out on its own**, and that is a budget rule too. 0018 costs
  revocation at 3 row-writes, same as a login, so a **cycle is 6** — 500/day platform-wide,
  100 per principal, half what `0014` §C's "1,000 logins/day" implies to anyone who has not
  counted logout. No auto re-login, no retry loop around `login`, and **no revocation on a
  `401`** (the session is already gone; revoking would spend 3 row-writes deleting nothing).

On XSS, stated precisely: an injected script **cannot exfiltrate** the credential —
`HttpOnly` puts it out of reach of every JavaScript API. It **can still act as the user**
for as long as the page is open, via same-origin requests the browser attaches the cookie
to. `HttpOnly` removes credential theft, not session abuse.

## Choosing an Organization

**A `200` from login is not a usable session.** Every session is created with no
Organization selected, and until one is recorded *server-side* every business request
answers `422 failed_precondition` — for every principal, not only for people who belong to
more than one Organization. Contract:
`packages/contracts/core/identity/organization-selection-v1.contract.yaml`; decision:
`docs/decisions/0021-session-routes.md`.

The client attempts the work and reacts to the refusal. It **does not** call the picker
after login:

1. `POST /auth/login/complete`. Do not branch here — the response has no field saying
   whether an Organization is selected, deliberately.
2. Make the request the person asked for.
3. On `failed_precondition`, resolve it, then `GET /auth/session/organizations`, present
   the choice, `POST /auth/session/organization`, and let the screen re-read.

With **exactly one** Organization the picker is not drawn and it is selected immediately.
That skips the *menu*, never the *call*: the request is byte-identical to the one a drawn
picker would send, which is why the server cannot tell and does not record the difference.
There is no server-side fallback and no client-side memory of a previous choice — a local
copy of the selected tenant would be an ambient tenant in the one place Dudo has none.

**Step 3 needs a probe, and this is the part that is easy to get wrong.** The contract says
a 422 from any route means "no Organization selected". That is not true of the deployed
platform: `customer-directory-v1` uses `failed_precondition` for its own state machine, and
`kernel/errors.ts` builds both with no arguments and a constant message, so **the two are
byte-identical**. A 422 therefore opens nothing by itself. It triggers `probeSession`, which
calls `core.ListAuthorizedBusinesses` — an Action that declares *no* `failed_precondition`,
so a 422 from it cannot have come from the Action and must have come from authentication,
before the router. Only that answer opens the picker. Without it, archiving an
already-archived customer would draw an Organization picker.

The **mid-session** case is the same code and is not a special case: membership is
re-validated on every request, so a revoked membership collapses the session back to
unselected at the *next* request and the person returns to the picker with an explanation —
not to a login screen, which `0021` notes would be a loop that cannot terminate.

**Organizations have no names.** `display_name` is always `null` because
`0002_organization.sql` declined a name column, so the picker lists 22-character
identifiers and says so. No placeholder name is invented, in either client.

Reviewing it locally, with no backend — this is what was missing when the step shipped
unbuilt:

```
VITE_DUDO_FIXTURE_ORGANIZATIONS=2 npm run dev   # the picker
VITE_DUDO_FIXTURE_ORGANIZATIONS=1 npm run dev   # auto-select, no picker drawn (default)
VITE_DUDO_FIXTURE_ORGANIZATIONS=0 npm run dev   # the no-membership state
```

The fixture transport refuses with the same constant `failed_precondition` until a
selection is made, so the same client code runs in both builds.

## Verifying

No test framework is approved (`architecture.md` §6, TS1 open), and an agent may not
install one. These run on Node's own WebCrypto with **zero dependencies** and import the
**real modules**, not copies:

```
npm run verify              # typecheck + all four below
npm run verify:kdf          # the KDF, and the shared cross-client test vectors
npm run verify:transport    # what the HTTP transport puts on the wire
npm run verify:auth         # the login request body, field by field
npm run verify:organization # the two session routes, and the 422 discriminator
```

`verify:kdf` prints the **shared test vectors** ADR 0015 §D requires QA to bind both
clients with. An Apple implementation that does not reproduce them character for character
is a cross-client contract defect.

## What this application does not do

- **It decides nothing.** Permission, tenant resolution and the authorized-business set
  are decided in `platform/core/**` on every call. Client-side validation exists so a
  person is told about a mistake before they submit it; the server validates again and
  its answer wins.
- **It shows no total count.** The contract returns none, and the reason is tenant
  isolation rather than performance. "Showing 25 customers" is true; "25 of 247" is not
  available and is not invented.

## Data

`src/api/fixtures.ts` holds 34 synthetic customers across three Businesses of one
Organization. Every name is invented, every email uses a reserved example domain, and
every address and phone number is made up. **Nothing resembling real customer data may
ever be added** (`.claude/rules/security.md` §6). State lives in memory for the life of
the page; a reload restores the fixtures.
