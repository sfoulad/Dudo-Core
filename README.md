# Dudo — Dudo-Core

**Status: pre-alpha. Not ready for use.**

*(This line read "pre-alpha MVP" until 2026-09-08. The MVP framing was withdrawn on
2026-09-06 by [`docs/decisions/0030`](docs/decisions/0030-full-system-zero-cost-and-expandability.md);
the target is the full system, built **admin-first** per
[`0035`](docs/decisions/0035-admin-first-and-the-milestone-program.md). "Not ready for use"
is unchanged and is not softened by either.)*

Dudo is a business-management platform for startups and SMEs. This repository,
**Dudo-Core**, holds the server side of the product, the responsive web application, and
the public extension surface.

The native Apple application lives in a separate repository, **Dudo-Apple** (Xcode,
Swift, and SwiftUI for iPhone, iPad, and macOS). Both clients consume the same published
contracts from this repository.

## What this repository contains

| Area | Purpose |
|---|---|
| **Core API** | Domain logic, business rules, APIs, authorization, multi-tenancy, workflows, and auditing |
| **Responsive web application** | The browser client |
| **Public contracts** | The versioned contracts every client and plugin speaks through |
| **Plugin runtime** | The host that loads and brokers plugins |
| **Plugin SDK** | The public surface third parties build against — manifests, lifecycle, permission declarations |

## Current state

> **Corrected 2026-09-08.** This section said **"No application code exists yet"** and
> **"the directories are placeholders"** long after neither was true — in the public README
> of a public repository, which is the worst place in the tree for that sentence to rot.
> Nothing goes red when a status paragraph goes stale, which is the whole of
> `.claude/rules/workflow.md` §12.

**Application code exists and is deployed.** Core domain logic, authorization, tenancy,
auditing and the platform routes are in `platform/core/`; the responsive web application
and the platform admin console are in `platform/web/`; the published contracts are in
`packages/contracts/`; the suites are in `packages/testing/`; the first business App is
`apps/customers/`.

**Not started, and still README-only:** the capability registry and App runtime
(`platform/capabilities/`), the plugin SDK (`packages/sdk/`), and Connectors
(`connectors/`).

**Stack.** **TypeScript on Cloudflare** — Workers for the API and web backend, D1 for
relational tenant data, R2 for files, Queues for asynchronous work, Workflows for
long-running processes, and Durable Objects only where real coordination is needed. See
[`docs/decisions/0003-technology-stack-typescript-on-cloudflare.md`](docs/decisions/0003-technology-stack-typescript-on-cloudflare.md).
The web application stack is [`0016`](docs/decisions/0016-web-application-stack.md) and the
admin interface stack is [`0010`](docs/decisions/0010-admin-interface-frontend-stack.md).
**No Cloudflare service beyond the six above is approved**, and each further one needs its
own record.

**Setup, build and run instructions are still not published here.** That is now a
deliberate gap rather than an unmet precondition, and it is owed.

## How Dudo is built

**Admin-first, full-system scope, in named milestones.** The target is the whole product —
Core, both clients, the capability registry and SDK, Connectors, and the business Apps —
with the **administration product built complete first**, through Milestones 0–6. Work runs
continuously and stops at named milestones for the project owner to test and accept. See
[`docs/decisions/0035`](docs/decisions/0035-admin-first-and-the-milestone-program.md) and
[`0030`](docs/decisions/0030-full-system-zero-cost-and-expandability.md).

*(This section described "one small, complete vertical feature at a time" — the pre-`0030`
policy, superseded on 2026-09-06.)* **What did not change:** a feature is not finished when
it compiles, production actions require the owner's explicit approval every time, and
**acceptance belongs to the project owner alone.** The delivery requirements are in
[`docs/product/mvp-delivery-policy.md`](docs/product/mvp-delivery-policy.md), whose pacing
sections are superseded and whose Apple, web and public-repository requirements still hold.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/product/vision.md`](docs/product/vision.md) | What Dudo is and who it is for |
| [`docs/product/mvp-delivery-policy.md`](docs/product/mvp-delivery-policy.md) | How features are delivered and accepted |
| [`docs/architecture/boundaries.md`](docs/architecture/boundaries.md) | Module ownership and allowed dependencies |
| [`docs/decisions/`](docs/decisions/) | Decision records, including what is still undecided |
| [`docs/operations/`](docs/operations/) | Planned repository configuration and CI roadmap |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branching, pull requests, and contribution rules |
| [`SECURITY.md`](SECURITY.md) | How to report a vulnerability |

## Repository layout

```
platform/core/          domain logic, APIs, authorization, tenancy
platform/web/           responsive web application + platform admin console
platform/capabilities/  capability registry and App runtime      (README only)
apps/                   installable business Apps — customers/
connectors/             adapters to external platforms           (README only)
packages/contracts/     shared cross-module contracts
packages/sdk/           the SDK App developers build against     (README only)
packages/testing/       test suites and shared harness
agents/                 agent rules, prompts, task specifications
scripts/ tools/         repository checkers and the suite runner
docs/                   product, architecture, decisions, operations, releases
```

*(`apps/` read "reserved — none yet" until 2026-09-08; the Customer Directory App has been
there since the first slice. The three marked **README only** genuinely are.)*

## Licence

**[Apache License 2.0](LICENSE)**, adopted 2026-09-01 for both `Dudo-Core` and
`Dudo-Apple`. The `LICENSE` file is the unmodified upstream text, with no added clauses.

Apache-2.0 is permissive and carries an explicit patent grant, which matters for an
extensible platform that expects third-party Apps and connectors. The trade-off was
accepted knowingly: **it permits commercial reuse by anyone, including competitors.**

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). This is a single-owner pre-alpha project; the
workflow is documented, but the project is not yet set up to take outside contributions.
