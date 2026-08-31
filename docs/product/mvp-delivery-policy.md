# Dudo — MVP Delivery Policy

How a Dudo feature goes from idea to something the user has actually used and accepted.
Binding on the Team Lead and every agent. Decision of record:
`docs/decisions/0002-repository-and-mvp-delivery-strategy.md`.

## 1. One vertical slice at a time

Dudo is **MVP-focused**. The team builds **one small, complete vertical feature at a
time**, and **does not begin the next feature until the user has tested and accepted the
current one**.

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

## 4. The feature completion gate

A feature is complete only when **all seven** conditions hold:

| # | Condition | Owner |
|---|---|---|
| 1 | Core contract is approved | `core-agent` authors, Team Lead approves |
| 2 | Core implementation passes tests | `core-agent` |
| 3 | Web implementation is deployed to the test environment | `web-agent` + Team Lead |
| 4 | Apple implementation is uploaded to internal TestFlight | `app-agent` + Team Lead |
| 5 | QA reports exact test evidence for both | `qa-agent` |
| 6 | Team Lead gives the user the web URL, TestFlight build number, release notes, and test checklist | Team Lead |
| 7 | **The user explicitly accepts the feature** | **User only** |

**No agent may begin the next feature before step 7.**

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
still-processing TestFlight build is reported exactly that way, and step 7 waits.

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
