# Dudo — Delivery Policy

How Dudo work reaches something the user has actually used and accepted. Binding on the
Team Lead and every agent. Decisions of record:
`docs/decisions/0002-repository-and-mvp-delivery-strategy.md` and
**`docs/decisions/0030-full-system-zero-cost-and-expandability.md`**.

> ## ⚠ THE PACING RULES IN THIS DOCUMENT ARE SUPERSEDED. THE DELIVERY REQUIREMENTS ARE NOT.
>
> **`0030` withdrew the MVP framing on 2026-09-06.** Sections **1** (one vertical slice at
> a time) and **4** (the seven-step gate) no longer bind — work runs continuously and stops
> at named milestones.
>
> **Everything else in this document still binds**, and none of it was an MVP concession:
> the Apple and web release requirements, release honesty, the rule that a build is not
> testable until it is processed and available, **production actions requiring explicit user
> approval every time**, and public-repository safety.
>
> The struck sections are kept rather than deleted. **They were right on their own terms**,
> and the seven-step shape is still the right checklist for what a milestone owes the user —
> it is the *waiting* that was withdrawn, not the *evidence*.

## 1. ~~One vertical slice at a time~~ — SUPERSEDED by `0030`

~~Dudo is **MVP-focused**. The team builds **one small, complete vertical feature at a
time**, and **does not begin the next feature until the user has tested and accepted the
current one**.~~

**Now:** the target is the full system. Work runs continuously; milestones are named, and
the user accepts them. **Milestone acceptance is still the user's alone** — never inferred
from silence, never assumed from a green run.

A **vertical slice** goes all the way through:

```
contract → Core implementation → web implementation → Apple implementation
        → tests → web test release → internal TestFlight build → user acceptance
```

A slice that stops at the API is not a slice. A slice that ships on web but not Apple is
not a slice. "Small" is the objective: the narrowest capability that is genuinely useful
end to end, on both clients.

Breadth is the enemy here. Two half-features in flight produce nothing testable; one
complete narrow feature produces something the user can accept.

## 2. Apple delivery

Every completed feature slice produces an **internal TestFlight build** for user testing.

The Dudo Apple application must:

- **Increment its build number for every test release.** Never reuse or reset a build
  number. The build number is how the user identifies what they are testing.
- **Include concise "What to Test" instructions** — what changed, what to exercise, what
  to look for. Short and specific.
- **Report build, unit-test, UI-test, archive, validation, upload, and processing results
  truthfully.** Each stage is named with its actual outcome. A stage that was skipped is
  reported as skipped, not omitted.
- **Never claim a build is testable until it is processed and available to the internal
  tester.** These are distinct states and must not be conflated:

  | State | Meaning | May you call it testable? |
  |---|---|---|
  | Archived | Build produced locally | **No** |
  | Validated | Passed App Store validation | **No** |
  | Uploaded | Transferred to App Store Connect | **No** |
  | Processing | Apple is processing it | **No** |
  | Processed and available to the internal tester | The user can install it | **Yes** |

- **Never submit to the public App Store without separate user approval.** Internal
  TestFlight distribution is not App Store submission, and approval for one is never
  approval for the other.

## 3. Web delivery

Every completed feature slice produces a **deployed web test release**.

Each web release must:

- Use a **test or staging environment — never production.**
- Have a **stable URL** the user can open. Not a local port, not an ephemeral preview
  that expires before the user gets to it.
- Include, stated explicitly:
  - the **feature version**;
  - the **commit SHA** deployed;
  - **test account requirements** — what the user needs to sign in and exercise it;
  - the **acceptance checklist** — what the user should verify.
- Consume **the same approved contracts as the Apple application.** One contract set,
  two clients. Divergence between what the web and Apple clients expect is a defect.
- **Never deploy to production without separate user approval.**

## 4. ~~The feature completion gate~~ — the CHECKLIST survives, the BLOCKING does not

> **SUPERSEDED by `0030` (2026-09-06).** Work no longer stops after each feature.
> **The seven conditions below remain the right list of what a milestone owes the user** —
> read them as *"what evidence is owed"*, never as *"when to wait"*.

~~A feature is complete only when **all seven** conditions hold:~~

| # | Condition | Owner |
|---|---|---|
| 1 | Core contract is approved | `core-agent` authors, Team Lead approves |
| 2 | Core implementation passes tests | `core-agent` |
| 3 | Web implementation is deployed to the test environment | `web-agent` + Team Lead |
| 4 | Apple implementation is uploaded to internal TestFlight | `app-agent` + Team Lead |
| 5 | QA reports exact test evidence for both | `qa-agent` |
| 6 | Team Lead gives the user the web URL, TestFlight build number, release notes, and test checklist | Team Lead |
| 7 | **The user explicitly accepts the feature** | **User only** |

~~**No agent may begin the next feature before step 7.**~~ **SUPERSEDED by `0030`** — work
does not wait on acceptance. **The seven conditions remain the right checklist for what a
milestone owes the user; only the blocking was withdrawn.**

Step 7 is the user's alone. It cannot be inferred from silence, assumed from a passing
test run, granted by the Team Lead, or claimed by any agent. "The Team Lead said the
slice looked good" is not acceptance.

Steps 4 and 5 interact with §2: step 4 is satisfied by *upload*, but step 6 cannot be
truthfully performed until the build is **processed and available**, because the user
cannot test what they cannot install.

## 5. Release reporting standard

When the Team Lead performs step 6, the handoff to the user states:

- **Web:** stable staging URL, feature version, commit SHA, test account requirements,
  acceptance checklist.
- **Apple:** TestFlight build number, its actual processing state, and "What to Test".
- **QA evidence:** exact results for both clients — passed, failed, skipped, not run.
- **Known gaps:** anything not covered, not working, or not yet verified.

Honest partial delivery is reported as partial. A slice with a green web release and a
still-processing TestFlight build is reported exactly that way — ~~and step 7 waits~~ **and
under `0030` the work does not wait, but the milestone is not claimed complete until the
build is genuinely installable. Reporting it as partial is the requirement; stopping is
not.**

## 6. Public-repository safety

Both repositories are public. Before the first public push, and on an ongoing basis:

- **Never commit** credentials, certificates, provisioning profiles, API keys, private
  customer data, or local environment files.
- The **original master-plan PDF stays outside both public repositories** until the user
  approves publication.
- **Public visibility does not decide the software license.** License selection is an
  open user decision.
- **Run a secrets and sensitive-information review before the first public push.**

A credential committed to a public repository is compromised the moment it lands, and
deleting the file does not remove it from git history. Treat any exposure as an incident
and report it immediately — never quietly clean it up. See `SECURITY.md`.
