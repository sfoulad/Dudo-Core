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

**No application code exists yet, and no technology stack has been selected** for this
repository — language, framework, database, and hosting are all open decisions.

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
core/                   domain logic, APIs, authorization, tenancy
apps/                   responsive web application
packages/contracts/     shared cross-module contracts
plugins/                plugin runtime and first-party plugins
packages/plugin-sdk/    plugin SDK, manifests, lifecycle
tests/                  test suites
docs/                   product, architecture, decisions, operations
```

## Licence

**No licence has been selected yet.** No `LICENSE` file exists, which means default
copyright applies and no permissions are granted. A licence decision is pending.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). This is a single-owner pre-alpha project; the
workflow is documented, but the project is not yet set up to take outside contributions.
