# CI Roadmap

Planned automation for both Dudo repositories.

> **No workflows exist and none are created yet.** This is a plan, not a description of
> working automation.
>
> Deliberately **not** created: empty or fake-success workflows, Dependabot ecosystems
> for package managers that do not exist, CodeQL configuration before any language is
> present, deployment workflows without a selected host, and TestFlight workflows without
> an Xcode project and an approved credential plan.
>
> A green check that verifies nothing is worse than no check, because it produces false
> confidence and would satisfy a required status check without doing any work.

## Dudo-Core — after the technology stack is approved

Everything below is blocked on the stack decision. Language, framework, database, and
hosting are all unselected, so the tools that would run these checks cannot be chosen yet.

| Stage | What it does |
|---|---|
| **Formatting / linting** | Style and lint gate for the approved language |
| **Type checking** | Static type verification, if the approved stack is typed |
| **Unit tests** | Domain and business-rule coverage |
| **Integration tests** | Core, API, and datastore working together |
| **Tenant isolation tests** | **Tenant A cannot read, write, enumerate, or infer tenant B.** A dedicated job, not a subset of another suite — this is Dudo's most important invariant |
| **Authorization tests** | Every entry point denies by default and authorizes explicitly |
| **Contract compatibility checks** | Published contracts stay backwards compatible; breaking changes are caught, and both consumers are verified against the same set |
| **Web build** | The responsive web application builds cleanly |
| **Staging deployment** | Deploys to `staging-web` **after an approved merge to `main`** — never from an open feature branch, and never to production |

## Dudo-Apple — after the Xcode project is created

Blocked on repository creation and Xcode project creation. Swift, SwiftUI, and Xcode are
approved; nothing beyond them is.

| Stage | What it does |
|---|---|
| **Swift formatting / linting** | Only if a formatter or linter is approved — it is an additional tool and needs its own approval |
| **`xcodebuild` — iPhone / iPad simulator** | Builds for the iOS simulator destinations |
| **Native macOS build** | Builds the **true native macOS destination — never Mac Catalyst** |
| **Unit tests** | Swift unit test targets |
| **UI tests** | Critical user flows only, kept narrow — UI tests are slow and brittle |
| **Contract compatibility checks** | The Apple client matches the published contract set, and has not drifted from the web client |
| **Internal TestFlight upload** | **Only from an approved release workflow**, never from an ordinary pull-request build. Requires an approved credential and signing plan first |

## Shared

| Stage | Applies to | Notes |
|---|---|---|
| **CodeRabbit PR review** | Both | Review only — no automatic fixes, commits, or merges. Configured in `.coderabbit.yaml` |
| **Dependency review** | Both | Added **only once dependency manifests exist** |
| **CodeQL** | Both | Added **only once the actual languages are present** — configuring it against an empty repository analyses nothing |
| **Production release** | Both | **Always requires separate explicit user approval.** Never automatic on merge |
| **App Store submission** | Dudo-Apple | **Always requires separate explicit user approval.** Internal TestFlight distribution is not App Store submission |

## Making checks required

A status check becomes a required check on `main` **only after it has run on a real pull
request and passed at least once.** Until then it stays advisory.

For CodeRabbit specifically: activate it, open a real pull request, observe the **exact
check name** it reports, and only then add that exact name to the ruleset. See
[`github-foundation.md`](github-foundation.md).

## Sequence

```
1. Approve the Dudo-Core technology stack        ← blocks everything in Dudo-Core
2. Create both repositories, push initial commits
3. Activate CodeRabbit; observe its check name
4. Add Dudo-Core CI as the stack lands; make checks required once they pass for real
5. Create the Dudo-Apple Xcode project           ← blocks everything in Dudo-Apple
6. Approve the Apple signing and credential plan ← blocks TestFlight automation
7. Add deployment only once a host is selected and approved
```

Steps 1, 2, 6, and 7 each need explicit user approval.
