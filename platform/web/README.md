# platform/web/ — Responsive web application

**Owner: `web-agent`** (see `docs/architecture/boundaries.md`)

The browser client for Dudo, across desktop, tablet, and phone widths.

> Moved here from `apps/` by `docs/decisions/0004-repository-structure.md`. `apps/` is now
> reserved for installable business Apps.

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

## What is built

The **Customer Directory**, contract `customer-directory-v1`, running against fixture
data. Five screens:

| Screen | Address | Actions used |
|---|---|---|
| Directory | `#/customers` | `ListCustomers`, `SearchCustomers` |
| Record | `#/customers/{id}` | `GetCustomer`, `ArchiveCustomer`, `RestoreCustomer` |
| New customer | `#/customers/new` | `CreateCustomer` |
| Edit customer | `#/customers/{id}/edit` | `GetCustomer`, `UpdateCustomer` |
| Not found | any other address | — |

`MoveCustomerToBusiness` has a client method and no screen. `DeleteCustomer` and
`RestoreDeletedCustomer` have **neither** — they are contracted and deliberately out of
scope for this slice (contract §11.1), so nothing in this application offers them.

## Zero dependencies, by constraint and by choice

**No web framework and no npm package is approved for `Dudo-Core`.** ADR `0003` approves
TypeScript and six Cloudflare services; it approves no framework, no bundler and no
library, and adding one is a user decision (`.claude/rules/security.md` §7).

So this is plain HTML, plain CSS and vanilla JavaScript ES modules, served as static
assets. **There is no `package.json`, no `node_modules`, no build step and no bundler.**
Open `index.html` from a static server and it runs. That is not a workaround — a CRUD
directory is comfortably within the web platform, it deploys as Worker assets at zero
cost against `0008`, and it starts instantly.

## Running it

ES modules are blocked over `file://` by browser CORS rules, so it needs a static server.
Anything will do:

```
cd platform/web
python3 -m http.server 8931 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8931/`.

### Seeing the error states

Nothing fails on its own — a directory that failed at random would teach people to click
through real problems. Faults are injected explicitly from the page's query string:

```
http://127.0.0.1:8931/?fault=list#/customers
http://127.0.0.1:8931/?fault=detail&faultCode=forbidden#/customers/cus_7Kq2mVx4
http://127.0.0.1:8931/?fault=write#/customers/new
```

`fault` is one of `list`, `detail`, `write`, `all`. `faultCode` is any platform error
code; it defaults to `unavailable`.

## Layout

```
index.html                    the only page
assets/dudo-mark.svg          the identity, taken from the app icon
styles/tokens.css             colour, type, space and shape tokens
styles/base.css               element defaults, buttons, form fields
styles/app.css                shell, directory, record, form
src/main.js                   entry point — wires shell, router and client
src/router.js                 hash routing
src/dom.js                    element construction; textContent only, no innerHTML
src/api/client.js             the contract-shaped client, and the HTTP route table
src/api/fixture-transport.js  the stand-in for Core
src/api/fixtures.js           synthetic data
src/api/errors.js             the error envelope, client side
src/domain/field-rules.js     schema constraints, transcribed
src/domain/format.js          presentation formatting
src/ui/                       shell, shared components, toasts
src/views/                    the four screens
```

## Swapping the fixture for the real API

One file. `src/api/client.js` takes a transport with a single
`invoke(action, input)` method; `fixture-transport.js` implements it from memory today,
and an `http-transport.js` will implement it against the routes already transcribed in
`client.js` (`BASE_PATH` + `ROUTES`). **No view changes**, because no view knows which
transport it is talking to.

Two fixture-only things must go at the same time, and both are marked in the code:

- `FIXTURE_ACTING_PRINCIPAL` in `fixture-transport.js` — the real
  `updated_by_principal_id` is derived server-side and is never chosen by a client.
- `listBusinesses()` on the client and `FIXTURE_BUSINESSES` in `fixtures.js` — **no
  contract publishes the Businesses a principal may file a customer under**, and
  `business_id` is required on `CreateCustomer`. This is an open contract request, not a
  shape this client intends to keep.

## What this application does not do

- **It makes no network call.** Nothing authenticates and no environment is deployed
  (contract §11, item 1 — AZ2).
- **It decides nothing.** Permission, tenant resolution and the authorized-business set
  are decided in `platform/core/**` on every call. Client-side validation exists so a
  person is told about a mistake before they submit it; the server validates again and
  its answer wins.
- **It never renders customer text as markup.** `src/dom.js` sets text with
  `textContent` and has no `innerHTML` path, so that is a property of the helper rather
  than a rule each view has to remember.
- **It shows no total count.** The contract returns none, and the reason is tenant
  isolation rather than performance (`packages/contracts/common/pagination.schema.json`).
  "Showing 25 customers" is true; "25 of 247" is not available and is not invented.

## Data

`src/api/fixtures.js` holds 34 synthetic customers across three Businesses of one
Organization. Every name is invented, every email uses a reserved example domain, and
every address and phone number is made up. **Nothing resembling real customer data may
ever be added** (`.claude/rules/security.md` §6). State lives in memory for the life of
the page; a reload restores the fixtures.
