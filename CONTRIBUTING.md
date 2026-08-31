# Contributing to Dudo-Core

Dudo is pre-alpha and single-owner. These rules apply to everyone working in the
repository, including automated agents.

## Branching and pull requests

- **`main` is protected.** No direct pushes.
- Work happens on **feature branches**, one branch per feature slice.
  Suggested form: `feature/<short-description>`, `fix/<short-description>`.
- Every change reaches `main` through a **pull request**.
- **Squash merge only.** Merge commits and rebase merging are disabled, so a pull
  request lands as exactly one commit on `main`.
- **Branches are deleted after merge.**
- **Conversations must be resolved** before merging.
- **Conventional commit titles are preferred but not required yet** — e.g.
  `feat: add invoice draft endpoint`, `fix: correct tenant scope on export`. Squash-merge
  titles become the history, so make them descriptive either way.

## Contract-first development

Cross-module work does not begin before its contract exists and is agreed.

1. The need is identified.
2. The contract is authored in `packages/contracts/**` — **only** there, and only by the
   Core owner. Clients and plugins consume contracts; they never author them.
3. The contract is reviewed and agreed.
4. Only then do the web client, the Apple client, and plugins implement against it.
5. Contract tests bind producer and both consumers.

A contract defines the request shape, the response shape, the error cases, the
authorization expectation, and the tenant scoping. **A type alone is not a contract.**

If a contract you need is missing or ambiguous, **request it and wait**. Do not stub a
shape, guess a field, or work around the gap.

**Both clients consume one approved contract set.** A shape the web application has and
the Apple application does not — or the reverse — is a contract defect, not a
client-local workaround.

## Tests

- **Tests are required once executable code exists.** While the repository holds only
  documentation and placeholders, there is nothing to test and no test framework has been
  selected.
- Once code exists, a pull request that changes behaviour includes tests for it.
- Any feature touching tenant data carries an explicit isolation test: tenant A must not
  read, write, enumerate, or infer tenant B.
- **Never weaken a test to produce a pass** — no deleted assertions, no added skips, no
  widened tolerances, no stubbing past a real failure. A failing test that describes
  reality is a valid deliverable.
- **Report results honestly**: passed, failed, skipped, and not run, itemised. Never
  round a partial run up to "all passing."

## Every feature ships to both test surfaces

A feature is not complete when it compiles. Every feature slice must deliver:

- a **testable web release** on a test or staging environment — never production — with a
  stable URL, the feature version, the commit SHA, test account requirements, and an
  acceptance checklist; and
- an **Apple test build** on internal TestFlight, with an incremented build number and
  concise "What to Test" instructions.

A build is **never** described as testable until it is processed and available to the
internal tester. Archived, validated, uploaded, and processing are distinct states, and
none of them means testable.

The full seven-step completion gate is in
[`docs/product/mvp-delivery-policy.md`](docs/product/mvp-delivery-policy.md). The final
step — explicit acceptance by the project owner — cannot be inferred, assumed, or
self-granted.

## Deployment

- **No direct production deployment from a feature branch.** Ever.
- Staging deployment happens from an approved merge, not from an open branch.
- **Production deployment and public App Store submission each require separate explicit
  approval from the project owner.** Approval for a staging deploy is not approval for
  production; approval for an internal TestFlight build is not approval to submit to the
  App Store.

## Secrets and private material

This repository is **public**. Never commit:

- credentials, API keys, tokens, or passwords;
- certificates, signing keys, provisioning profiles, or keystores;
- private customer data or real business data — use synthetic data everywhere;
- local environment files (`.env` and variants);
- private planning documents, including the project's master build-plan PDF.

Reference secrets by name and keep values in an approved secret store. A credential
committed to a public repository is compromised the moment it lands, and deleting the
file does **not** remove it from git history.

**If a secret is exposed, report it immediately** to the repository owner. Do not quietly
delete it and move on — it needs rotation, not cleanup.

## Scope discipline

Each area of the repository has one owner. Do not edit outside the area you are working
in; raise the need instead. Ownership, allowed dependencies, and forbidden edges are
documented in [`docs/architecture/boundaries.md`](docs/architecture/boundaries.md).

## Review

Pull requests are reviewed automatically by CodeRabbit, which comments only — it does not
commit, fix, or merge. Automated review is not a substitute for the owner's judgement.
