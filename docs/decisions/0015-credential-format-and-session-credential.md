# 0015 — Credential format and the session credential (AZ2, continued)

- **Status:** **Accepted** — §D decided 2026-09-04
- **Date:** 2026-09-03
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-03 ("Go with your
  recommendation"). §D carries a user-reversible consequence — see Approval.
- **Owning agent:** Team Lead records. Drafted by `architecture-agent`, implemented by
  `core-agent`.
- **Closes:** `0014`'s "the identity provider itself" · unblocks `SessionCredentialReader`

## Context

`0014` A, B and C are merged and **nothing authenticates**. The Worker passes
`createDenyAllPrincipalResolver`, and `session-principal-resolver.ts` declares
`SessionCredentialReader` as a port with no implementation.

Four constraints found **in the merged code** decide most of this before any preference
applies.

### 1. The write-admission port structurally forbids a stateful login start

`ControlPlaneWriteAdmission.reserve` requires a `principalId` that is *server-derived from a
verified credential*. At `identity.login.start` nothing is verified, so **no reservation
exists and no durable write is legal.** This is not a budget that can be raised — the type
has no value to pass.

Any format needing server-side state at login start **cannot be built against the platform as
it stands.** Challenge state must be a signed value the caller carries — which the pre-auth
registry already anticipated by including `dudo_login_state` in its closed credential-name
set.

### 2. Workers Free allows 10 ms CPU per request, which caps any password KDF

Measured against WebCrypto by the Team Lead:

| | |
|---|---|
| PBKDF2-SHA256, OWASP's recommended 600,000 iterations | **~72 ms — 7× the entire budget** |
| PBKDF2-SHA256, 100,000 iterations | ~12 ms — already over |
| PBKDF2-SHA256, most that fits | **~60,000 — one tenth of OWASP** |
| ECDSA P-256 verify | **0.09 ms** |
| HMAC-SHA256 verify | 0.011 ms |

**PBKDF2 is not equivalent to Argon2id and the gap cannot be closed with iterations**, because
Argon2id's defence is *memory* hardness and PBKDF2 has none — a GPU evaluates it orders of
magnitude faster than a server CPU. Argon2 and bcrypt are npm packages; none is approved.

**What 60,000-iteration PBKDF2 is actually worth.** A single consumer GPU sustains roughly
2–5 billion PBKDF2 iterations/second, so **~50,000 password guesses per second per card**. A
standard ~10¹⁰-candidate wordlist campaign finishes in **~2.3 days on one card, ~7 hours on
eight** — and campaigns that size typically recover 70–80% of human-chosen passwords. **If the
control-plane database is stolen, assume the majority of passwords are recovered.** Not "at
risk". Recovered. bcrypt at cost 12 is ~35× the work; Argon2id is stronger again by a
mechanism PBKDF2 does not possess at any iteration count.

**A CORRECTION TO THIS RECORD, made 2026-09-03 after it was first written.** The original text
said the CPU ceiling caps *password-hashing strength*. **That was false. It caps SERVER-SIDE
password-hashing strength**, and the distinction admits an option the first draft missed —
see §D option (f). The error is corrected rather than quietly rewritten because an Accepted
record carrying a false premise is the exact defect this project has spent its effort
eliminating.

**The derived hard ceiling, and an argument against running near it.** The measurements give a
clean linear fit of **0.120 ms per 1,000 iterations** with ~0.5 ms fixed overhead across a 60×
range, so the absolute maximum is **~75,000 iterations** once the rest of the login path is
allowed for. **60,000 leaves only ~23% headroom and should not be shipped**, for a reason
beyond conservatism: **a CPU-limit kill produces a response Dudo did not author.**
`pre-auth-http.ts` is a fixed table precisely so every branch is byte-identical; if the
invocation is terminated at 10 ms, `finish()` never runs, the timing floor never applies, and
the caller receives a runtime error whose shape Core does not control. That is an intermittent
disclosure channel outside the fixed table.

### 3. A timing floor inside a Worker cannot measure CPU work — at all

Cloudflare's security model, verified directly:

> *"`Date.now()` returns the time of the last I/O. **It does not advance during code
> execution.**"*

This is a deliberate Spectre mitigation, and it defeats `0014` §B's response floor for
CPU-bound work in two ways: `timing_overrun` **cannot fire** for a CPU overrun — the alert
Part B installed as its honest admission that Core cannot enforce equal work is blind to
exactly that failure — and the deadline is computed from a stale instant, making the floor
**additive** (`work + 250 ms`) rather than absolute, so a KDF's duration passes straight
through to the wire.

**The consequence is larger than a bug.** Measure-then-pad is *structurally impossible* inside
a Worker for CPU-bound branches. **The only available defence against a CPU timing oracle is
to make the work equal, never to measure and compensate.** A format whose branches differ in
CPU cost has an oracle that cannot be closed on this platform.

The floor is still useful for **I/O-bound** variance — D1 reads do advance the clock — and is
retained on that basis, with its scope stated honestly.

### 4. The pre-auth body floor rules out one OIDC flow shape

`PRE_AUTH_MAX_FIELD_LENGTH = 512`. An OIDC `id_token` is 600–1,200 characters, so a flow
posting one is rejected before any handler runs. **The authorization-code flow is mandatory**
for any OIDC option, not merely preferred.

## Decision

### A. The session credential

`<session_id>.<HMAC-SHA-256(session_id) truncated to 128 bits>`, keyed by a Worker secret,
compared in constant time. Carried in the existing `dudo_session` cookie for web and accepted
as `Authorization: Bearer` for Apple. **One value, two carriers, one contract.**

This resolves `0004_session.sql`'s recorded constraint — *"if the chosen format ever makes the
bearer token and `session_id` the same value, this table stores a credential in plaintext"* —
**without a verifier column and without a migration**, because the bearer token is strictly
*more* than the stored value. A reader of the session table cannot mint a credential without
the secret. It also rejects forgeries with **no D1 read at all**, and rotating one secret
invalidates every session on the platform.

`SessionCredentialReader` still returns a session identifier and nothing else.

### B. Session lifetime and rotation

1. **12 hours.** `createSessionResolver` requires an explicit value. Ten Organizations × ten
   principals × two logins/day = 600 row-writes, a fifth of the control-plane sub-ceiling.
2. **No rotation on any request** — 6 row-writes each, unaffordable by two orders of
   magnitude, and unnecessary: session fixation does not apply, because a session identifier
   is only ever minted server-side after verification.
3. **`identity.session.refresh` is not built in this slice.** Under absolute expiry it either
   does nothing or is a second login. It stays registered with no handler and therefore fails
   closed. Removing it from the five would amend an Accepted decision.

### C. Timing — required controls

1. **The floor's scope is corrected in code and in comment: it covers I/O variance, not CPU
   variance.** Claiming otherwise is the overclaim, given finding 3.
2. **`timing_overrun` must be documented as unable to detect a CPU overrun**, or removed. An
   alert that cannot fire for the condition it names is worse than no alert.
3. **Equal work on both branches is the primary defence, not the fallback.** `qa-agent` tests
   it directly; the overrun alert is not a sufficient detector.
4. The **250 ms quantum is retained** for I/O variance.

### D. The credential format — **DECIDED 2026-09-04: client-side KDF (option f)**

The measurement was taken and the answer went the other way. **Passkeys are the stronger
option and are not chosen.** Reasons, in the order they weigh:

1. **They cannot complete the gate on the schedule that matters.** ADR 0002 requires a slice
   through *both* clients. Passkeys add **3–5 days of hand-written CBOR and DER parsing in
   Swift** — plus two forced platform divergences — to the critical path of a client that has
   **never produced a build**. Option (f) uses `CCKeyDerivationPBKDF`, a system API.
2. **The security gap is smaller than it looks.** Client-side KDF gives an effective offline
   work factor of **~610,000 iterations — above OWASP's recommendation.** This is not "weaker
   crypto shipped for convenience"; it is adequate crypto that ships. It also **partly closes
   the online-guessing hole** ADR 0014 §B could not close by any means available to it,
   because the attacker now pays 600,000 iterations per attempt too.
3. **Recovery does not separate them.** Both are equally unrecoverable without an approved
   email provider. It was never a tiebreaker.
4. **It is the reversible choice, and passkeys are not.** A verifier column carrying an
   algorithm identifier lets Dudo migrate to passkeys later, transparently, on each user's
   next login. **Choosing the KDF now does not foreclose passkeys. Choosing passkeys now and
   failing to ship forecloses the slice.**

**This dissolves blocker 1.** No associated-domains entitlement, no
`-allowProvisioningUpdates`, no developer-portal write. The macOS build is untouched.

**Normative, and it is the difference between this design and a catastrophe: the server stores
a hash of the client's output, never the output itself.** A database dump must not be usable
as a login credential.

**Also normative:** the client salt is the normalised email, because
`identity.login.start` is `disclosure: 'collapsed'` and **a server-chosen salt is
undeliverable under the registry as built.** And the server-side hash runs at 10,000
iterations — 1.7 ms, 17% of the CPU budget — which keeps it far from the cap where a
runtime kill would produce a response outside the fixed table.

**The residual risk, recorded rather than softened:** a client that posted the raw password
instead of the KDF output would be indistinguishable to the server. Requiring exactly 43
base64url characters mitigates but does not close it. QA must bind both clients with shared
test vectors, because web (`crypto.subtle`) and Apple (`CCKeyDerivationPBKDF`) must produce
byte-identical output.

#### The option comparison that produced this — retained for the record

**Status of §D changed 2026-09-03.** It was first recorded as *passkeys, Accepted*. That was
decided on a premise now known to be false, and on a cost estimate now known to be too high.
Both corrections are below. §§A–C are unaffected and stand.

#### Option (f) — client-side KDF. The option the first draft missed.

```
client:  kdf_output = PBKDF2-SHA256(password, salt = normalize(email), 600,000, 32 bytes)
         posts { email, base64url(kdf_output) }        43 chars, fits the 512 cap
server:  stored == PBKDF2-SHA256(kdf_output, per_user_random_salt, 10,000)
```

An offline attacker must compute **both** KDFs per guess — **effective work factor ≈ 610,000,
above OWASP's recommendation** — against 60,000 for the server-side design. Guess rate falls
from ~50,000/s to ~5,000/s per GPU; the two-day campaign becomes three weeks. **Server CPU:
1.7 ms**, 17% of budget, which also eliminates the runtime-kill channel above.

**NORMATIVE, and the difference between this design and a catastrophe: the server stores a
hash of the client's output, NEVER the output itself.** Storing `kdf_output` directly would
make a database dump *directly usable as a login credential* with no cracking at all.

It also **partly closes Part B's online-guessing hole, which nothing else does** — the
attacker now pays 600,000 iterations per attempt too, converting a free attack into a metered
one. And it makes finding 3 immaterial: at 1.7 ms, identical on both branches, the frozen
clock cannot leak anything.

**The salt has a forced answer.** A per-user random salt would need fetching before login, but
`identity.login.start` is `disclosure: 'collapsed'` and renders one constant body — **there is
no way to deliver a server-chosen salt under the registry as built.** Normalised email as the
client salt removes the round trip. This is the construction Bitwarden ships.

**Its real costs:** two clients must produce byte-identical output (deterministic, so testable
— and a mismatch fails closed and loud, nobody can log in); **a client that posted the raw
password instead of the KDF output would be indistinguishable to the server** — partially
mitigated by requiring exactly 43 base64url characters, and this is the genuine residual risk;
and no server-side password policy is possible.

#### The WebAuthn cost was over-priced, and Core writes no binary parsing

Under `attestation: 'none'` — the correct choice — **the attestation object is verified by
nobody**, so the CBOR parse is pure data extraction, not a security control. Web's
`getPublicKey()` returns SPKI DER directly. Apple's client can extract the key, because the
value is untrusted either way. **The contract specifies one shape — `public_key_x` and
`public_key_y`, base64url, 43 characters each — and the server imports a JWK.** The DER
signature unwrap moves client-side too. **Core writes zero binary parsing**, against the
~250–350 lines the first draft priced.

#### Recovery is not a tiebreaker

**(d) and (f) share the gap: recovery is blocked by the absence of an approved email provider,
not by the credential format.** A forgotten password with no email is as unrecoverable as a
lost passkey. Synced passkeys (iCloud Keychain, Google Password Manager) do most of the work
for Dudo's actual users; requiring two credentials at enrollment reduces lockout further.

#### MEASURED ON THE APPLE CLIENT, 2026-09-03 — three corrections

`app-agent` measured this rather than reasoning about it. Repository untouched; every
experiment ran in scratchpad copies.

**1. §D is NOT blocked behind C5, and the Team Lead's suspicion that it was is withdrawn.**
Apple's CDN fetches the AASA by default — observed in `swcd`:
`route: cdn -> https://app-site-association.cdn-apple.com/a/v1/dudo.work`, refused with
`SWCERR00202 Connections to private/reserved IP addresses are not allowed`. **But
`webcredentials:dudo.work?mode=developer` flips the fetch to a direct
`/.well-known/apple-app-site-association` request from the domain, bypassing the CDN**, and
the simulator reports developer mode enabled by default. **The client plumbing is provable
against any device-reachable HTTPS host, with no Cloudflare and no C5 clearance.**
What *is* blocked behind C5 and deployment is gate steps 4 and 6 — a TestFlight tester on
their own device uses the CDN path, and `mode=developer` is not available to them.

**2. "Core writes zero binary parsing" was true and misleading, and the framing was the Team
Lead's.** The parsing did not disappear — **it moved to the Apple client.** Apple exposes no
`getPublicKey()` equivalent, so the Apple app must hand-write **CBOR attestation parsing plus
a DER signature unwrap in Swift**, on a project with no test target that has never archived.
**That is a cost transfer onto the riskiest client, not a cost reduction.** Honest Apple-side
estimate: **3–5 working days, not one**, excluding first-archive unknowns.

**3. Adding the entitlement breaks the macOS build today.** The macOS product currently signs
with no embedded provisioning profile; with `com.apple.developer.associated-domains` the build
fails — *"No profiles for 'com.dudo.work' were found… To enable automatic signing, pass
-allowProvisioningUpdates"*. **That flag is a developer-portal write, so it is a user-only
action, and it is the first gate — it blocks passkeys before any code is written.**

Also forced: `performAutoFillAssistedRequests()` is iOS-only, and `ASPresentationAnchor` is
`UIWindow` vs `NSWindow` — two platform divergences on a client that must ship to both.

**A prerequisite either way, and it is news: `dudo.work` currently resolves to a
private/reserved IP.** Apple's CDN will not fetch from it. Public DNS and domain ownership are
unconfirmed and are needed for the shipping path regardless of which option §D selects.

#### The deciding factor is delivery, not cryptography

Both are cryptographically adequate. The argument that decides it is that **`Dudo-Apple` has
never produced a TestFlight build** and already carries two blockers, and ADR 0002's gate
requires one complete vertical slice through **both** clients. WebAuthn adds associated
domains, an entitlement, and an `apple-app-site-association` file to that critical path.
**An option that cannot complete the seven-step gate is worse than a cryptographically weaker
one that can.**

**DECISION: prove the Apple associated-domain path first — roughly one day. If it works,
passkeys. If it does not, option (f).** Either way, **plain server-side PBKDF2 is ruled out**:
(f) costs the same to build, ships to the same clients, is ~10× stronger offline, uses a
quarter of the CPU, and removes the runtime-kill channel. There is no axis on which it wins.

#### Reference: the option comparison

With operator-issued single-use enrollment codes for bootstrap and recovery, and **passkey
registration behind an already-authenticated session** so CBOR parsing never sees
unauthenticated input.

| | money | npm | third party | writes/login | CPU timing oracle |
|---|---|---|---|---|---|
| Password + PBKDF2 | 0 | none | none | 3 | **unclosable — finding 3** |
| Emailed code | needs provider | none | email | 9 | n/a |
| OIDC, code flow | 0 | hand-written JWT validator | **yes** | 3 | outsourced |
| **WebAuthn / passkey** | **0** | **none** | **none** | **3** | **closed by construction** |

**Why, decisively:** finding 3 means a password's CPU timing oracle **cannot be closed on this
platform**. ECDSA verify is 0.09 ms and symmetric, so the branches are inherently equal and
nothing needs measuring. With discoverable credentials the client submits no account
identifier at all, so a miss is a failure to guess a 128-bit random value — **the existence
oracle is closed by construction rather than by equalisation.** No shared secret at rest means
**no offline cracking target exists.**

**OIDC was not chosen, and I could not choose it:** an external identity provider is a
third-party dependency requiring explicit user approval under `.claude/rules/security.md` §7,
which delegation does not confer. It also trades a ~40-line DER unwrap for a ~300-line
hand-written JWT validator — `alg=none`, RS256→HS256 confusion, `kid` injection — which is a
worse bargain when no library is available. And App Store guideline 4.8 would make Sign in
with Apple mandatory as a second provider.

**Accepted costs, recorded so they are not rediscovered:**

- **No self-service account recovery.** A lost device with no second passkey needs an
  operator.
- **Enrollment and recovery are manual operator actions.** This is a mechanism for a closed
  beta, **not a product.** It does not scale past it.
- **Some users cannot log in at all** — unsupported browser or device, with no fallback,
  because the fallback would be a password.
- A hand-written **~40-line DER signature unwrap on the pre-auth path**, parsing untrusted
  binary.
- **Highest Apple-client risk of the four**, on a client that has not shipped a TestFlight
  build and already carries two blockers.

## Consequences

- `SessionCredentialReader` gains its first implementation and the platform can authenticate.
- A **Worker secret** is added for the session HMAC key — provisioned by the Team Lead, never
  in the repository.
- A control-plane migration is needed for the credential, reviewed against
  `0001_principal.sql`'s two recorded omissions.
- **Free-tier impact: USD 0 / BD 0.** No new service, no new row in the register.
- `0014`'s deferred fourth-allocation question is **not** closed, and finding 1 shows it is
  not merely a labelling problem: the port has no parameter such a write could use.

## What this does NOT decide

**MFA** (largely subsumed by passkeys) · **revocation beyond delete-the-row** · **registration
and onboarding**, which `0014` records as having no auditable home · **delegation** · **the
App permission and trust ADR** · **App isolation**.

## Approval

§§A–C follow from constraints in merged code and from Cloudflare's documented behaviour.

**§D was decided under delegation and is the one a user may want back.** It buys strong
security properties at the price of self-service recovery and a manual enrollment path that
does not scale beyond a closed beta. **Nothing is implemented against it yet**, so reversing
it is cheap now and expensive later. If a conventional product with a real recovery story is
wanted, the answer is OIDC — and that requires explicit user approval of a named third party,
which this record does not have and does not claim.

## Amendment, 2026-09-04 — §D never said how to normalise the password

**§D specifies "the UTF-8 password" and stops there. That is a gap, not a choice**, and it was
found by `web-agent` while implementing the client rather than by anyone reviewing the record.

**The defect it leaves.** Any password containing a non-ASCII character can be typed in composed
or decomposed form. The two are different byte sequences, so they derive **different keys**.
Input methods do not agree on which they produce — a macOS keyboard, an iOS keyboard and a
browser can each hand the client a different encoding of what the user believes is one password.
The user enrols on one platform and cannot log in on the other, and the failure presents as a
wrong password, which is the least diagnosable form it could take.

**Why this is fixed now and could not be fixed later.** The derived key *is* the credential.
Nothing stores a plaintext password, so changing this rule after any credential is enrolled
invalidates that credential permanently, with no migration available. **Today the cost is one
line in each client. After the first enrolment the cost is every account.**

**Normative addition to §D:** the password is **NFC-normalised** before UTF-8 encoding.

```
web    password.normalize('NFC')
Apple  password.precomposedStringWithCanonicalMapping
```

**It is NFC, and specifically not NFKC.** The two normalisations now appear in the same code
path for different inputs, which is precisely how they get confused:

| Input | Normalisation | Why |
|---|---|---|
| **email** (the salt) | validate ASCII `0x21`–`0x7E`, then **NFKC**, then ASCII-only case folding | Collapsing compatibility variants is *correct* for an identifier: `ﬁ` and `fi` should reach the same account |
| **password** | **NFC** only — no case folding, no trimming, no ASCII restriction | Canonical composition fixes encoding differences without collapsing distinct characters |

**NFKC on a password would destroy entropy the user believes they have**, mapping distinct
characters onto one. The password is also not case-folded, not trimmed and not ASCII-restricted;
only the identifier is.

This follows **RFC 8265's PRECIS `OpaqueString` profile** — the profile SCRAM and SASL use for
this exact problem — which specifies composition normalisation, no case mapping, and no
compatibility mapping.

**Consequences.** `platform/core/identity/login.ts`'s header and
`packages/contracts/core/identity/login-v1.contract.yaml` both state the KDF input and must
carry this rule. The web and Apple clients each apply it locally; the Core **request path** never
sees a password and therefore cannot enforce it — **this is a rule only the clients can keep, which is why it belongs
in the contract rather than in a code comment.**

**Free-tier impact: none.**

### Correction, 2026-09-04 — "Core never sees a password" was too broad

`qa-agent` flagged this while deciding whether `tools/seed-principal.ts` was in scope for the
rule. The original sentence read *"Core never sees a password and therefore cannot enforce it."*
**That is true of the request path and false of the repository.**

`platform/core/identity/tools/seed-principal.ts` lives inside `platform/core/**`, and it **does**
see a password — it generates one and derives the client value from it. It is an operator tool, not
a request handler, but it is Core code and it is bound by this rule exactly as the two clients are.

**There are three implementations of the client-side KDF, not two**, and the enrolment tool is the
one nobody thinks of. It is also the most dangerous to get wrong: **a client that skips NFC fails
to log in, and an enrolment tool that skips NFC creates an account nobody can ever log into**, with
no plaintext stored anywhere to re-derive from.

This is not hypothetical. `qa-agent` recorded a near-miss: on its first read of the tree,
`deriveClientValue` encoded the password **without** NFC while the web client applied it. It was
corrected before testing, and the window existed.

**QA reading the sentence as too broad, and testing the tool as a third client anyway, is what
found it.** The reading was right; the sentence was wrong. It now says the Core **request path**.
