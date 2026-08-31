# Security Policy

Dudo is **pre-alpha** software. It is not released, not deployed for general use, and not
ready to hold real business data.

## Supported versions

| Version | Supported |
|---|---|
| Pre-release / `main` | Pre-release only — no security support commitments |

There are no released versions, and therefore no supported versions in the usual sense.
No backports, patches, or security fixes are promised for any build at this stage.

## Reporting a vulnerability

**Please report privately. Do not open a public issue, pull request, or discussion for a
security problem, and do not post exploit details publicly.**

Use **GitHub's private vulnerability reporting** on this repository:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the issue in the private advisory.

This creates a private security advisory visible only to you and the repository owner.

> If private vulnerability reporting is not yet enabled on this repository, please open a
> public issue containing **only** a request for a private contact channel — no
> vulnerability details, no reproduction steps, no exploit code — and the owner will
> open a private channel with you.

This project does not publish a security contact email address. Please use the private
advisory route above rather than any address you may find elsewhere.

### What helps

- What the issue is and why it matters.
- Steps to reproduce, or a proof of concept.
- The affected area, and the commit or branch you observed it on.
- Any impact on tenant isolation, authorization, or data exposure — these are treated as
  the most serious class of issue in Dudo.

### What to expect

This is a single-maintainer pre-alpha project. There is no guaranteed response time. The
owner will acknowledge reports as capacity allows and will tell you what is being done.

Please give the owner a reasonable opportunity to address the issue before disclosing it
publicly.

## Secrets must never be committed

Both Dudo repositories are public. Credentials, API keys, tokens, certificates, signing
keys, provisioning profiles, and environment files must **never** be committed.

A secret committed to a public repository is compromised the moment it lands, and
deleting the file does not remove it from git history — the value must be rotated.

**If you find a committed secret, report it privately using the process above.** Do not
open a public issue about it, and do not include the secret's value in your report.
