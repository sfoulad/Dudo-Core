# 0002 — Repository structure and MVP delivery strategy

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** User (explicit approval in conversation), Dudo Team Lead
- **Owning agent:** Team Lead

## Context

`0001` settled how decisions get sequenced but decided no architecture. This record
settles the product's delivery shape: what gets built, where the code lives, how it
reaches the user for testing, and when a feature counts as finished.

Two things forced it. First, Dudo needs a native Apple application alongside the web
application, and Apple and web have different build, signing, and distribution
realities that the team's rules did not previously acknowledge. Second, the team had no
definition of "done" — nothing distinguished code that compiles from a feature the user
has actually used and accepted. Without that, work accumulates unverified.

The product is now explicitly **MVP-focused**: one small, complete vertical feature at a
time, tested and accepted before the next begins.

## Options considered

### Repository structure

1. **Two repositories — `Dudo-Core` and `Dudo-Apple`** *(chosen)*. Separates the Apple
   toolchain from everything else. Xcode projects, signing configuration, and the Apple
   build lifecycle stay out of the web and backend repository, and each side gets a build
   pipeline suited to it. Costs a cross-repository contract dependency and coordinated
   releases.
2. **One monorepo** — simplest contract synchronization and one place to look, but binds
   Swift and web toolchains, CI, and release cadence together in a repository that must be
   public. Rejected.
3. **Three or more repositories** (splitting contracts or plugins out) — premature at MVP
   scale, and would multiply the version-coordination problem the MVP is trying to avoid.
   Rejected.

### Apple platform approach

1. **Native SwiftUI multiplatform with a true macOS destination** *(chosen)*. Best
   platform fidelity on each device class; a shared codebase avoids maintaining three
   applications.
2. **Mac Catalyst** — explicitly rejected by the user. It yields an iPad application
   wearing a macOS appearance, and the compromises show precisely in the places a
   business tool is used most.
3. **Cross-platform framework** (a single non-native UI toolkit for web and Apple) —
   rejected implicitly by choosing Swift and SwiftUI.

## Decision

### 1. Product

**Dudo** is an **MVP-focused business-management platform for startups and SMEs.**
Build **one small, complete vertical feature at a time.** Do not begin the next feature
until the user has tested and accepted the current one.

A vertical feature slice reaches all the way through: contract, Core implementation, web
implementation, Apple implementation, tests, and both delivered test releases. A slice
that stops at the API is not a slice.

### 2. Repositories

Exactly **two public GitHub repositories**:

| Repository | Contents |
|---|---|
| **`sfoulad/Dudo-Core`** | Core domain and business logic; API; responsive web application; shared contracts; plugin runtime; plugin SDK; architecture and public technical documentation |
| **`sfoulad/Dudo-Apple`** | Native Apple application named Dudo — Xcode, Swift, SwiftUI; iPhone, iPad, and macOS |

The Apple application uses a **true native macOS destination, not Mac Catalyst**, and
prefers a **shared multiplatform codebase with platform-specific implementations where
Apple UX genuinely differs** — navigation, window and scene management, menus, keyboard
and pointer interaction, and file handling being the expected divergence points.

**Neither repository is created and no remote is configured.** That requires separate
user approval.

> **Update 2026-08-31:** the user approved creation. Both repositories now exist and are
> public, and `Dudo-Core`'s remote is configured. `Dudo-Apple` is intentionally empty
> until its Xcode project is approved. The decision above is unchanged — only its
> pending status is.

### 3. Apple delivery

Every completed feature slice produces an **internal TestFlight build**. The Apple
application must:

- **Increment its build number for every test release.** No reused build numbers.
- Ship concise **"What to Test"** instructions with each build.
- **Report build, unit-test, UI-test, archive, validation, upload, and processing results
  truthfully** — each stage named, with its actual outcome.
- **Never claim a build is testable until it is processed and available to the internal
  tester.** Uploaded is not processed; processed is not available. Say which state it is
  actually in.
- **Never submit to the public App Store without separate user approval.**

### 4. Web delivery

Every completed feature slice produces a **deployed web test release**. Each release must:

- Use a **test or staging environment, never production**.
- Have a **stable URL** the user can open.
- State the **feature version, commit SHA, test account requirements, and acceptance
  checklist**.
- Consume **the same approved contracts as the Apple application** — one contract set,
  both clients.
- **Never deploy to production without separate user approval.**

### 5. Feature completion gate

A feature is complete only when **all seven** hold, in order:

1. Core contract is approved.
2. Core implementation passes tests.
3. Web implementation is deployed to the test environment.
4. Apple implementation is uploaded to internal TestFlight.
5. QA reports exact test evidence for both.
6. Team Lead gives the user the web URL, TestFlight build number, release notes, and test
   checklist.
7. The user explicitly accepts the feature.

**No agent may begin the next feature before step 7.** Steps 1–6 are the team's work;
step 7 is the user's alone and cannot be inferred, assumed, or granted by the Team Lead.

### 6. Team

| Agent | Scope |
|---|---|
| `core-agent` | Dudo-Core: domain, API, authorization, tenancy, auditing, contracts |
| `plugin-agent` | Dudo-Core: plugin runtime and SDK |
| `web-agent` | Dudo-Core: the responsive web application *(new)* |
| `app-agent` | Dudo-Apple: native Apple development only *(refocused)* |
| `qa-agent` | Verification across both repositories |
| Team Lead | Shared configuration, releases, integration, root test configuration |

`app-agent` no longer owns the web experience. `web-agent` is created to own it.

### 7. Public-repository safety

Both repositories are public from the start, so:

- **Never commit** credentials, certificates, provisioning profiles, API keys, private
  customer data, or local environment files.
- The original **master-plan PDF stays outside both public repositories** until the user
  approves publication.
- **Public visibility does not decide the software license.** License selection is an
  open user decision, recorded as such below.
- A **secrets and sensitive-information review runs before the first public push.**

## Consequences

- **A partial technology stack is now selected.** Swift, SwiftUI, and Xcode are approved
  for Dudo-Apple. This is the first technology entering Dudo under the project's
  no-default-stack rule, and it is scoped strictly to the Apple repository.
  **The Dudo-Core stack — language, framework, database, hosting, web framework — remains
  unselected**, as does the plugin isolation mechanism that `0001` binds to it.
- The delivery cadence is now the constraint on throughput. A slice cannot be declared
  done without a processed TestFlight build and a live staging URL, which makes the
  release pipeline a first-class dependency rather than an afterthought.
- Contracts must be consumed identically by two clients in two repositories. Contract
  versioning becomes a cross-repository coordination problem, and `qa-agent` must verify
  both consumers against one published contract set.
- Step 7 means the team will idle waiting for user acceptance. That is intended: it
  converts "we think it works" into "the user used it."
- Two public repositories mean every commit is permanently visible. The pre-push secrets
  review is not a formality — a leaked credential in public git history survives deletion.
- `qa-agent`'s surface roughly doubles: it now verifies a Swift/Xcode test stack it has no
  approved framework for yet, alongside an unselected web and Core stack.

## Approval

The user approved the product framing, both repositories and their contents, the Apple
platform approach, Apple and web delivery policy, the seven-step completion gate, the
team changes, and the public-repository safety rules explicitly in conversation on
2026-08-31.

The user explicitly withheld approval for, and this record does not perform: creating
either GitHub repository, configuring remotes, creating Xcode projects, writing
application code, deploying, creating TestFlight records, committing, or pushing.

Still requiring separate explicit user approval: repository creation, remote
configuration, any production deployment, any public App Store submission, publication of
the master-plan PDF, and the software license selection.

## Open decisions this record does not make

1. **Software license for both public repositories** — open user decision. Public
   visibility is not a license grant; without a license file the repositories are "all
   rights reserved" by default, which is unlikely to be the intent.
2. **The Dudo-Core technology stack** — language, framework, database, hosting, web
   framework. Still unselected, and it carries the plugin isolation mechanism with it
   per `0001`.
3. **The first vertical feature slice** — which business capability ships first.
4. **Local working location for `Dudo-Apple`**, and where its Apple test targets live for
   `qa-agent` ownership purposes.
5. **CI, signing, and deployment mechanics** for both delivery paths, including which
   Apple team and bundle identifier the application uses.
