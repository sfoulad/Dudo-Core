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

## Layout

```
index.html                       Vite entry
public/dudo-mark.svg             the identity, taken from the app icon
src/main.tsx                     entry point
src/App.tsx                      route table
src/styles/index.css             Tailwind v4 @theme tokens + the directory table rules
src/lib/                         cn(), hash router, last-list memory
src/contracts/                   contract-derived TYPES, field rules, formatting
src/api/                         client, fixture transport, fixtures, error envelope
src/components/ui/               copy-in shadcn-style primitives
src/components/                  shell, toaster, state blocks
src/screens/                     the four screens
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

## Swapping the fixture for the real API

One file. `src/api/client.ts` takes a `Transport` with a single `invoke(action, input)`
method; `fixture-transport.ts` implements it from memory today, and an `http-transport.ts`
will implement it against the routes already transcribed in `client.ts` (`BASE_PATH` +
`ROUTES`). **No screen changes**, because no screen knows which transport it is talking to.

Two fixture-only things must go at the same time, and both are marked in the code:

- `FIXTURE_ACTING_PRINCIPAL` in `fixture-transport.ts` — the real
  `updated_by_principal_id` is derived server-side and is never chosen by a client.
- `listBusinesses()` and `FIXTURE_BUSINESSES` — **no contract published the Businesses a
  principal may file a customer under** when this was built, and `business_id` is required
  on `CreateCustomer`. A `core/organization/business-read-v1` contract now exists; this
  goes away when it is consumable.

## What this application does not do

- **It makes no network call.** Nothing authenticates and no environment is deployed
  (contract §11 item 1 — AZ2).
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
