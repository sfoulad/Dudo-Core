# `@dudo/ui` — the presentation primitives

Shared by **`app.dudo.work`** (`platform/web`) and **`admin.dudo.work`** (`platform/admin`).
ADR `0036` named this layer; ADR `0040` made it exist as a package.

Everything here is copy-in source in the shadcn/ui manner: it lives in this repository, it
is ours to edit, and it is not a component library we depend on (`0016` §2).

## The one rule, and it is not a style rule

> **THIS LAYER CARRIES NO AUTHORITY.**
>
> A component that **renders** a member row is shared. A component that **decides whether
> the viewer may see it** is not, and does not belong here. **The two administrations share
> a look. They do not share a permission model, a data layer, or a route tree** (`0035`,
> `0036`).

And the reason a hidden control is not a control: `security.md` §2 — *UI-level hiding is
presentation, never security. A hidden button is still reachable.* Every screen in both
consoles is reachable by typing its URL, and the server is what refuses. A primitive named
as though it decided something would be the first place a future author looked for a
guarantee that has never been here.

**Until `0040` this rule had no subject.** `check:ui-purity` guarded one host's private
directory, and there was no shared component for the constraint to apply to — it was
correct and inert. It applies to something now.

## What that forbids, mechanically

`npm run check:ui-purity` fails when anything under `src/` imports:

| Forbidden | Why it is not shared |
|---|---|
| a data layer (`api/`, an HTTP client) | Two administrations, two data layers |
| a contract or domain vocabulary | One App's words. `badge.tsx` used to know what `pending_deletion` meant, which is what made a second surface either import the Customer Directory or write its own pill |
| application state (`use-session`, tenant selection) | All of it is one host's |
| `@tanstack/react-router` | The route tree. `0035` gives the two consoles different ones; a primitive emitting `<Link to="/customers">` has picked one |
| `@tanstack/react-query` | Server state. A primitive that fetches has a data layer whether or not it admits to one |

**`@tanstack/react-table` is permitted, and it is the only one of `0036`'s six libraries
that is.** The exception is stated rather than assumed: it is *headless*. It computes a
column model and renders nothing, so it carries no route, no request and no opinion about
who may look.

The check reports the population it examined against a pinned expectation, and **ships with
a known-failing fixture that every rule must fire on** — `workflow.md` §11a, because a check
that has never been shown to fail has been observed rather than verified.

## What is here

| Module | Exports |
|---|---|
| `cn.ts` | `cn` |
| `button.tsx` | `Button`, `ButtonLink`, `Spinner`, `buttonVariants` |
| `field.tsx` | `Input`, `Textarea`, `Select`, `Field`, `ReadOnlyValue` |
| `badge.tsx` | `Badge`, `Tag` — tones, no domain |
| `panel.tsx` | `Panel`, `StateBlock`, `Skeleton`, `SkeletonRows` |
| `table.tsx` | `Table`, `TableHead`, `TableBody`, `TableRow`, `TableHeaderCell`, `TableCell`, `NotRecorded` |
| `data-table.tsx` | `DataTable` — the TanStack Table binding, rendering through `table.tsx` |
| `segmented-control.tsx` | `SegmentedControl` |
| `pagination.tsx` | `Pagination` — cursor paging, and no total, ever |
| `toast.tsx` | `Toaster`, `toast`, `dismiss` |

Consume through the barrel: `import { Button, Field } from '@dudo/ui'`.

## Two things the hosts must do, and one of them fails silently

**1. Tailwind has to be told to scan this package.** These files are outside both hosts'
`src/`, so neither host's content detection reaches them by default. Each host's stylesheet
carries an explicit `@source` pointing here.

> **Get that wrong and every class in this package is purged. The build succeeds, the types
> check, and the console renders unstyled.** That is the "compiles perfectly and is wrong"
> failure, and it is why `platform/admin`'s `verify:css` extracts class candidates from this
> package as well as from its own `src/` — a check that examined only `src/` would have gone
> green while the primitives had no rules at all.

**2. React is a peer dependency, not a dependency.** Two copies of React in one page is a
broken application rather than a slow one: hooks resolve against whichever copy the
importing module found, and the failure is an unmountable tree, not a compile error. The
same class of hazard applies to `toast.tsx`'s module-level queue — see its header.

## What was merged to create this, and what it cost to find out

`0040` originally directed that `platform/admin`'s two primitives be **deleted**, on the
measurement that its `button.tsx` was 80% larger with **fewer exports**. The measurement was
right; the inference was not. Admin's copies carried three things web's lacked:

- the **`onNavy`** variant — a named treatment for a control on the navy header.
  **Web has the same need and solved it differently**, with `ghost` plus inline
  overrides that are transparent-until-hover where this variant is always-on with a
  border. Only admin named it. Web is deliberately **not** switched to it here, because
  that would be a visual change rather than a relocation;
- **`type = 'button'`** as `Button`'s default, which is a defect web had been carrying: an
  unset `type` inside a `<form>` is `submit`, and web paid for it at five call sites;
- an **announced error** on `Field`, now the `announce` prop.

**Neither copy was the fuller one.** The third item also carried a genuine conflict — admin's
assertive announcement is safe *because* its errors are set on submit and cleared on change,
and web's form re-validates as you type. So the behaviour became a prop with **the
precondition documented on the prop rather than in a comment on one host's copy**, which is
how the two ended up different with no way to notice.

## Adding one

Derive it from what a screen already hand-rolls, not from a component gallery. The standard
`0036` sets is that **a second screen never re-implements what the first one already
solved** — a statement about duplication that exists, not about components that might be
wanted.

Accessibility is part of finished, not a follow-up: a real `<label for>`, a real
`<th scope>`, `aria-sort` on the header rather than on a glyph, and a control reachable from
the keyboard. Every spacing and radius utility is **logical** — `start`/`end`, never
`left`/`right` — because Dudo will need RTL and `0010`'s rule is not cosmetic.

**Radix** is approved transitively under shadcn/ui (`0036`) and **nothing here needs it
yet** — `field.tsx` uses native `input`, `select` and `textarea` on purpose. It arrives with
the first modal dialog or menu, where a hand-rolled focus trap is where accessibility
actually goes wrong. **A seventh library that is not Radix is a new user approval**, and that
includes `@hookform/resolvers`.
