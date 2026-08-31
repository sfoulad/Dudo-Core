# GitHub Foundation — Planned Configuration

The intended GitHub configuration for both Dudo repositories.

> **Applied 2026-08-31.** Both repositories exist and the configuration below is live,
> with the exceptions marked **Pending** — required status checks, and any secret. Items
> deliberately *not* done (workflows, Dependabot ecosystems, CodeQL, `LICENSE`) remain
> not done, with the reasons stated.

Applies to **`sfoulad/Dudo-Core`** and **`sfoulad/Dudo-Apple`** unless noted.

| | |
|---|---|
| `sfoulad/Dudo-Core` | Public. Foundation commit pushed to `main`. |
| `sfoulad/Dudo-Apple` | Public. Intentionally empty until the Xcode project is approved. |

## Visibility

- **Public**, both repositories, from creation.
- Public visibility does **not** decide the software licence. No `LICENSE` file exists
  and none is created until the user selects one. Until then default copyright applies
  and no permissions are granted.
- The private master build-plan PDF is **never** committed or published, and stays
  outside both repositories.

## Branches

- **`main` is the default branch**, and is protected.
- Feature branches plus pull requests for all changes. No direct pushes to `main`.
- **Squash merge enabled.**
- **Merge commits disabled. Rebase merging disabled.** A pull request lands as exactly
  one commit.
- **Automatically delete head branches after merge.**

## `main` protection ruleset

| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | Yes | Nothing lands directly on `main` |
| **Required approvals** | **0 — none initially** | See below |
| Require conversation resolution before merging | Yes | Review comments get answered, not buried |
| Block force pushes | Yes | History on `main` stays intact |
| Block branch deletion | Yes | `main` cannot be removed |
| Required status checks | **None initially** | See below |

### Why no human approval requirement

This is presently a **single-owner project**. Requiring an approving review when the
owner is the only person with access means either the owner approving their own pull
request — which GitHub restricts and which carries no real review value — or a permanently
blocked merge. **The approval requirement stays at zero until there is a second
reviewer**, at which point it should be raised to 1.

### Why no required status checks yet

**Do not require a status check until it genuinely exists and has passed at least once.**
A required check that never reports blocks every merge permanently, and a check wired up
to pass without doing anything is worse than no check at all.

Checks become required only after they run for real:

1. CI workflows, once they actually exist and run. The stack is approved (`0003`), but no
   workflow has been written and none may be required before it has passed once for real.
2. **CodeRabbit** — after activation, observe the **exact check name it reports** on a
   real pull request, then add that exact name as required. Do not guess the name in
   advance.

### Never enable "prevent self-review"

While **Sameh is the only reviewer**, enabling "prevent self-review" — or requiring
review from someone other than the last pusher — would make it impossible to merge
anything, and therefore impossible to deploy. Revisit only when a second reviewer exists.

## GitHub Actions

- **Default workflow token permissions: read-only.** Set at the repository level.
- **Write permissions granted per job, only where genuinely required**, via an explicit
  `permissions:` block on that job. No blanket write at the workflow or repository level.
- Fork pull requests do not receive secrets.
- **No workflows are created during foundation setup.** See
  [`ci-roadmap.md`](ci-roadmap.md) — no empty workflows, no fake-success jobs, no
  deployment workflow without a selected host, no TestFlight workflow without an Xcode
  project and an approved credential plan.

## Security features

Enable where available on a public repository:

- **Dependency graph**
- **Dependabot vulnerability alerts**
- **Dependabot security updates**
- **Secret scanning**
- **Secret scanning push protection** — blocks a commit containing a recognised secret
  before it reaches the remote
- **Private vulnerability reporting** — the channel `SECURITY.md` directs reporters to.
  This must be enabled explicitly, or the documented reporting route will not work.

**Dependabot version updates are not configured**, because no package manifests exist
yet. Ecosystems are added only when a real manifest exists for them.

**CodeQL is not configured**, because no source code in any language exists yet. It is
added only when the actual languages are present.

## Environments

Three environments, created empty:

| Environment | Purpose | Protection |
|---|---|---|
| `staging-web` | Web test releases | Deploy from approved merges to `main`. Not production. |
| `testflight-internal` | Apple internal TestFlight builds | Internal testers only. Never a public App Store submission. |
| `production` | Live production | **Required reviewer: explicit user approval on every deployment.** |

- **`production` requires explicit user approval.** Approval for a staging deploy is
  never approval for production, and approval does not carry forward between deployments.
- **No environment secrets are added during foundation setup.** Secrets are added only
  when a deployment target exists and the user has approved the credential plan.
- Public App Store submission is out of scope for all three environments and requires
  separate explicit user approval.

## Repository metadata

- Description and topics: set at creation.
- Issues: enabled, with the templates in `.github/ISSUE_TEMPLATE/`. Blank issues are
  disabled so reports arrive structured.
- Wiki, Projects, Discussions: not enabled initially.

## Not part of foundation setup

- No `LICENSE` — pending the user's licence decision.
- No GitHub releases, tags, or packages.
- No deployment configuration — no host has been selected.
- No secrets of any kind, in any scope.
