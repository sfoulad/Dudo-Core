# Dudo — Dudo-Core

**Status: pre-alpha MVP. Not ready for use.**

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

**No application code exists yet.** The stack is now decided: **TypeScript on
Cloudflare** — Workers for the API and web backend, D1 for relational tenant data, R2 for
files, Queues for asynchronous work, Workflows for long-running processes, and Durable
Objects only where real coordination is needed. See
[`docs/decisions/0003-technology-stack-typescript-on-cloudflare.md`](docs/decisions/0003-technology-stack-typescript-on-cloudflare.md).

No web framework, testing framework, or third-party dependency has been selected — those
are separate decisions, and no Cloudflare service beyond the six above is approved.

What exists today is the structure the code will be built into: module boundaries,
binding development rules, agent definitions, product documentation, and decision
records. The directories are placeholders.

**Executable setup, build, and run instructions will be added only after the technology
stack is approved and recorded** as a decision. Publishing setup steps before then would
mean inventing them.

## How Dudo is built

One small, complete vertical feature at a time. A feature is not finished when it
compiles — it is finished when it has shipped to a web test environment and an internal
Apple test build, been verified, and been accepted by the project owner. The full policy
is in [`docs/product/mvp-delivery-policy.md`](docs/product/mvp-delivery-policy.md).

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
platform/web/           responsive web application
platform/capabilities/  capability registry and App runtime
apps/                   installable business Apps (reserved — none yet)
connectors/             adapters to external platforms (reserved — none yet)
packages/contracts/     shared cross-module contracts
packages/sdk/           the SDK App developers build against
packages/testing/       test suites and shared harness
agents/                 agent rules, prompts, task specifications
docs/                   product, architecture, decisions, operations
```

## Licence

**No licence has been selected yet.** No `LICENSE` file exists, which means default
copyright applies and no permissions are granted.

**Apache-2.0 is the current recommendation** — a permissive licence with an explicit
patent grant, well understood by the developer ecosystem an extensible platform depends
on. It has not been adopted: a permissive licence allows commercial reuse of this code by
anyone, including competitors, and that trade-off needs an explicit decision rather than
a default.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). This is a single-owner pre-alpha project; the
workflow is documented, but the project is not yet set up to take outside contributions.
