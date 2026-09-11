# Third-party notices — `platform/admin`

ADR 0010 requires that the MIT notices of the adopted work be preserved, "with attribution
to the upstream author recorded in the adopting directory". This is that record.

## shadcn-admin

- Upstream: `https://github.com/satnaing/shadcn-admin`
- Revision adopted: `e16c87f213a5ba5e45964e9b67c792105ec74d26` (2026-06-11)
- Licence: **MIT**
- Copyright (c) satnaing

Adopted as the **visual and component reference**. ADR 0010: "This is not a clone." What is
taken is the layout shape — a fixed header over a collapsible sidebar and a main region — and
the shadcn/ui component conventions. What is **not** taken is listed in 0010's adoption audit
and is absent from this directory:

| Removed | Why (ADR 0010) |
|---|---|
| `@clerk/react` and all template authentication logic | Dudo Core is the sole authority for authentication. |
| `netlify.toml` | Deployment is Cloudflare under ADR 0003. |
| `.env.example` | Template sample credentials; forbidden in a public repository. |
| `@faker-js/faker`, demo users, fake APIs, placeholder data | "Fabricated data in an admin console is worse than no data — an operator cannot tell it from real." |
| `chats`, `tasks`, template `apps`/`users` demo screens | Not in the shell scope. |

No upstream source file is copied verbatim into this directory. The template's design tokens
are **not** used: ADR 0010 requires Dudo's own tokens, because "retaining the template's brand
would ship someone else's identity, and the template's tokens are not accessibility-checked
against Dudo's palette." See `src/styles/index.css`.

## shadcn/ui

- Upstream: `https://github.com/shadcn-ui/ui`
- Licence: **MIT**
- Copyright (c) shadcn

Components are **copied into the codebase by design** rather than installed as a package —
that is shadcn/ui's distribution model, and ADR 0010 adopts it on that basis.

**THE COPIES ARE NO LONGER IN THIS DIRECTORY.** They were `src/components/ui/button.tsx` and
`src/components/ui/field.tsx`; ADR 0040 merged them with `platform/web`'s equivalents into
**`packages/ui` (`@dudo/ui`)**, which this console consumes as a workspace dependency. Both
remain modified for Dudo's tokens and for logical (RTL-safe) properties, and **the attribution
travels with the code** — `packages/ui` carries its own notice.

## Runtime and build dependencies

Every package below was verified free and open-source before use, as ADR 0010 and ADR 0008
require. Licences read from each package's own `package.json` and `LICENSE` in
`node_modules` at the versions resolved for this project.

| Package | Version resolved | Licence | Why it is here |
|---|---|---|---|
| `react` | 19.2.8 | MIT | ADR 0010's approved stack. |
| `react-dom` | 19.2.8 | MIT | ADR 0010's approved stack. |
| `clsx` | 2.1.1 | MIT | Conditional class strings; required by the shadcn `cn` helper. |
| `tailwind-merge` | 3.6.0 | MIT | Resolves conflicting Tailwind classes; required by `cn`. |
| `class-variance-authority` | 0.7.1 | Apache-2.0 | The variant helper shadcn components are written against. |
| `vite` | 7.3.6 | MIT | ADR 0010's approved stack. |
| `@vitejs/plugin-react` | 5.2.0 | MIT | React support for Vite. |
| `typescript` | 5.9.3 | Apache-2.0 | ADR 0010's approved stack. |
| `tailwindcss` | 4.3.3 | MIT | ADR 0010's approved stack, Tailwind v4. |
| `@tailwindcss/vite` | 4.3.3 | MIT | The v4 Tailwind plugin for Vite. |
| `@types/react` | 19.2.18 | MIT | Type definitions (DefinitelyTyped). |
| `@types/react-dom` | 19.2.7 | MIT | Type definitions (DefinitelyTyped). |
| `@tanstack/react-router` | 1.170.33 | MIT | ADR 0036. Routing; replaced a hand-rolled hash router. |
| `@tanstack/react-query` | 5.102.8 | MIT | ADR 0036. Server state; every read and write goes through `src/lib/queries.ts`. |

**Three of the four workspace packages this console depends on are Dudo's own and carry no
third-party obligation of their own beyond what their notices record:** `@dudo/ui` (see
`packages/ui/NOTICE.md` — it holds the shadcn/ui copies), `@dudo/client-kdf` (zero
dependencies), and `@dudo/contracts` (types only, zero dependencies).

`@tanstack/react-table` is **not** a dependency of this console. It reaches the build through
`@dudo/ui`, which declares it, and is recorded there.

`class-variance-authority` and `typescript` are **Apache-2.0, not MIT**. Both are permissive
and compatible; the distinction is recorded because ADR 0010 requires each licence to be
recorded rather than assumed, and assuming "MIT like the rest" is how a licence obligation
gets missed.

### Deliberately not installed

> **⚠ THIS TABLE LISTED `@tanstack/react-router`, `@tanstack/react-query` AND
> `@tanstack/react-table` AS NOT INSTALLED WHILE TWO OF THEM WERE RUNNING THE CONSOLE.**
> Corrected 2026-09-09. ADR 0036 approved them and they landed; nothing sent anyone back to
> the file that asserted their absence.
>
> **A "not installed" table is a claim about ABSENCE, and it rots in the direction nobody
> checks.** A wrong entry in the table above is caught the moment someone needs the licence.
> A wrong entry *here* is only caught by someone who already knows the package is present —
> and for a NOTICE file on a public repository the failure is **under-disclosure**, which is
> the direction that matters. **Adding a dependency means editing two tables in this file.**

| Package | Why not |
|---|---|
| `axios` | ADR 0010: "The platform runs on `fetch`. A second HTTP client is a second place for auth headers and error handling to diverge." |
| `@faker-js/faker` | Fabricated data. Removed by 0010 and never reintroduced. |
| `@tanstack/react-table` | Not a direct dependency. It arrives through `@dudo/ui`, which declares it for the headless table state, and is recorded in `packages/ui/NOTICE.md`. |
| `zustand` | No client state beyond two hooks. |
| `recharts` | 0010: "Only if the dashboard genuinely charts something. Not for decoration." There is no dashboard. |
| Radix UI packages | The shell has no dialog, menu, combobox or popover. Adding one is the moment to add Radix. |
| `date-fns`, `cmdk`, `input-otp`, `react-day-picker`, `sonner`, `react-top-loading-bar` | No screen in the shell uses any of them. |
