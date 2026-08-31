## Summary

<!-- What this change does, and why. One or two sentences. -->

## Affected areas

<!-- Tick everything this PR touches. -->

- [ ] `platform/core/**` — domain, API, authorization, tenancy, auditing
- [ ] `packages/contracts/**` — shared contracts
- [ ] `platform/web/**` — responsive web application
- [ ] `platform/capabilities/**` — capability registry and App runtime
- [ ] `packages/sdk/**` — the SDK App developers build against
- [ ] `apps/**` — an installable business App
- [ ] `connectors/**` — external platform adapter
- [ ] `packages/testing/**` — test suites
- [ ] `agents/**` — agent rules, prompts, task specifications
- [ ] `docs/**` — documentation
- [ ] Repository configuration / tooling
- [ ] `Dudo-Apple` (coordinated change in the other repository)

## Contract changes

- [ ] No contract change
- [ ] Additive contract change (backwards compatible)
- [ ] **Breaking contract change** — requires review and a decision record

<!-- If a contract changed: which contract, which version, who consumes it, and
     whether BOTH clients (web and Apple) have been updated. Divergence between
     the two clients is a defect, not a workaround. -->

## Tenant isolation impact

<!-- Does this touch any tenant-scoped data path? If yes: how is tenant scope
     derived (it must come from the authenticated server-side context, never
     from client input), and which test proves tenant A cannot reach tenant B?
     If no tenant data is involved, say so explicitly. -->

- [ ] No tenant-scoped data path is touched
- [ ] Tenant scope is enforced and covered by an isolation test

## Authorization / security impact

<!-- New or changed entry points, permission checks, or auth paths. Remember:
     UI-level hiding is presentation, never security. -->

- [ ] No authorization surface changed
- [ ] Authorization is decided in Core, denies by default, and is tested

## Plugin permission impact

- [ ] No plugin permission surface changed
- [ ] Permissions are manifest-declared, narrowly scoped, tenant-scoped, and enforced
      by Core on every invocation

## Tests

<!-- Record ACTUAL results. Never round a partial run up to "all passing".
     If no executable code exists yet, write "not applicable — no code yet". -->

| Suite | Passed | Failed | Skipped | Not run |
|---|---|---|---|---|
| Unit |  |  |  |  |
| Integration |  |  |  |  |
| Tenant isolation |  |  |  |  |
| Contract |  |  |  |  |

<!-- Paste the actual command output or link to the run. Failures included. -->

## Web staging status

- [ ] Deployed to the test/staging environment
- [ ] Not applicable

**Stable URL:**
**Feature version:**
**Commit SHA deployed:**
**Test account requirements:**
**Acceptance checklist:**

## Apple TestFlight status

- [ ] Uploaded to internal TestFlight
- [ ] N/A — no Apple change in this PR

**Build number:**
**Actual state:** <!-- archived / validated / uploaded / processing / processed and available -->
**What to Test:**

> A build is **not** testable until it is processed and available to the internal
> tester. Report the state it is actually in.

## Screenshots / evidence

<!-- Screenshots for UI changes, output for behavioural changes, or "none". -->

## Migration and rollback

<!-- Does this need a migration? Is it reversible? How would you roll it back?
     If nothing to migrate, say "no migration; revert the squash commit". -->

## Confirmations

- [ ] **No secrets, credentials, API keys, tokens, certificates, signing keys, or
      provisioning profiles are included in this PR.**
- [ ] **No private documents are included** — including the master build-plan PDF.
- [ ] **No real customer or business data** is included; fixtures are synthetic.
- [ ] No `.env` or local environment file is included.
- [ ] This PR does not deploy to production or submit to the public App Store.
- [ ] Test results above are reported honestly, including failures.
