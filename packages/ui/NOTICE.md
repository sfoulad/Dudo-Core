# Third-party notices — `packages/ui` (`@dudo/ui`)

ADR 0010 requires that the MIT notices of the adopted work be preserved, **"with attribution
to the upstream author recorded in the adopting directory"**. This is that record for the
shared primitive package.

## Why this file exists, and why it did not until 2026-09-09

**ADR 0040 moved the shadcn/ui copies out of `platform/admin/src/components/ui/` and
`platform/web/src/components/ui/` into this package. The attribution did not move with them.**

For a period, `platform/admin/NOTICE.md` recorded the shadcn/ui copyright while naming two
files that were no longer in that directory, and this package held the code with no notice at
all. **That is `workflow.md` §2b's half-move landing on a licensing artifact rather than on an
import**, and it is worse than the usual form for two reasons:

- **Nothing goes red.** No build, type check or test observes that an attribution has been
  separated from the work it attributes. The consumer sweep that catches a broken import
  cannot see a notice left behind, because a notice is not imported by anything.
- **Both repositories are public** (`architecture.md` §8). An MIT notice is a condition of
  use, not documentation — the obligation is to keep the copyright notice with the copies.

**The general form, recorded because it will recur:** when code moves between packages, ask
what travels with it besides its imports — **attribution, licence text, and the security or
provenance claims made about it in the tree it is leaving.**

## shadcn/ui

- Upstream: `https://github.com/shadcn-ui/ui`
- Licence: **MIT**
- Copyright (c) shadcn

Components are **copied into the codebase by design** rather than installed as a package —
that is shadcn/ui's distribution model, and ADR 0010 adopts it on that basis.

`src/button.tsx` and `src/field.tsx` descend from those copies. They are **merged from the two
consoles' previously separate versions** and modified for Dudo's design tokens and for logical
(RTL-safe) properties, so they are derivative rather than verbatim. The remaining modules in
`src/` — the panel, badge, table, data-table, segmented control, pagination, toast and `cn`
helper — are **Dudo's own** and are not shadcn/ui code.

**The template's design tokens are NOT used.** ADR 0010 requires Dudo's own, because
*"retaining the template's brand would ship someone else's identity, and the template's tokens
are not accessibility-checked against Dudo's palette."*

## Dependencies

This package declares **one** runtime dependency, and `react` as a peer rather than a
dependency — two copies of React in one application is a broken application, so the host
supplies it.

| Package | Version resolved | Licence | Why it is here |
|---|---|---|---|
| `@tanstack/react-table` | 9.2.4 | MIT | Headless table state for `data-table.tsx`. It renders nothing and makes no request, which is what lets it sit inside a no-authority layer. |
| `react` (peer) | 19.2.8 | MIT | Supplied by the consuming application, never bundled here. |

Licences read from each package's own `package.json` in `node_modules` at the versions
resolved for this project, as ADR 0010 and ADR 0008 require — **recorded rather than assumed**,
because assuming "MIT like the rest" is how a licence obligation gets missed.
