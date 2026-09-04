/**
 * ===========================================================================================
 * THE IDENTITY SLICE, ASSEMBLED. `docs/decisions/0014` §§B and C, `docs/decisions/0015` §§A–D.
 * ===========================================================================================
 *
 * Every piece the login slice needs is a port with one implementation, and this file is the one
 * place they are put together. It exists so that `http/adapters/worker-entry.ts` — the file that
 * names Cloudflare types — does not also have to know the resolution order, the session lifetime,
 * which secret keys which primitive, or which of the five pre-authentication entry points has a
 * handler. That is domain knowledge and it belongs on this side of the adapter boundary.
 *
 * IT TAKES PORTS AND KEYS AND RETURNS PORTS. It names no binding, no `Env`, no D1 type and no
 * Durable Object, so a verification harness composes exactly what production composes by passing
 * fakes for the two stores. That is the property that makes the equal-work argument in
 * `credential-verifier.ts` testable at all: `qa-agent` can drive the real handler with a store
 * that hits and a store that misses, and measure both.
 *
 * ===========================================================================================
 * WHAT IT REFUSES TO BUILD, AND WHY THE REFUSAL IS THE POINT
 * ===========================================================================================
 *
 * A `PreAuthLimiter` IS A REQUIRED ARGUMENT AND THERE IS NO DEFAULT. `0014` §B admits a
 * permissionless route only if it carries rate limiting, and the only limiter implementation in
 * this repository counts in one isolate's memory. `pre-auth-limiter.ts` says what that is worth in
 * production, and it is not this file's to overrule:
 *
 *   *"In a deployed Worker there are many isolates and they are created and destroyed at the
 *   edge's discretion, so a per-isolate counter is a limit divided by a number nobody controls —
 *   which is not a limit. ... the production composition root must not wire this."*
 *
 * So the caller supplies one or login is not composed. There is deliberately no
 * `limiter = limiter ?? createInProcessPreAuthLimiter()` fallback anywhere in this file: a
 * fallback is how "the limiter is not wired" stops being obvious, and this is the one path an
 * unauthenticated caller can drive.
 */

import type { Clock } from '../kernel/clock.ts';
import type { IdGenerator } from '../kernel/ids.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import type { PrincipalResolver } from './principal-resolver.ts';
import type { IdentityControlPlaneStore } from './control-plane-store.ts';
import type { ControlPlaneWriteAdmission } from './control-plane-admission.ts';
import type { PrincipalAuthorizationSource } from './principal-authorization-source.ts';
import type { CredentialStore } from './credential-store.ts';
import type { SessionResolver } from './session-resolution.ts';
import { createSessionResolver } from './session-resolution.ts';
import { createSessionPrincipalResolver } from './session-principal-resolver.ts';
import { createCredentialVerifier } from './credential-verifier.ts';
import { createHmacIdentifierHasher } from './credential-store.ts';
import {
  createSessionCredentialReader,
  createSessionCredentialSigner,
  SESSION_LIFETIME_MS,
} from './session-credential.ts';
import { createLoginHandlers } from './login.ts';
import { createSessionRouteHandlers } from './session-route-handlers.ts';
import type { SessionRouteDependencies } from './session-routes.ts';
import type {
  PreAuthDependencies,
  PreAuthFailureReporter,
  PreAuthEvidenceRecorder,
  PreAuthLimiter,
  PreAuthSleeper,
} from './pre-auth-admission.ts';
import { createHmacIdentifierBucketer } from './pre-auth-admission.ts';

export type IdentityCompositionInput = {
  readonly store: IdentityControlPlaneStore;
  readonly credentials: CredentialStore;
  readonly admission: ControlPlaneWriteAdmission;
  readonly authorization: PrincipalAuthorizationSource;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /**
   * REQUIRED, AND THERE IS NO DEFAULT. See the header. Supplying
   * `createInProcessPreAuthLimiter()` here in a deployed Worker is the one thing this argument
   * exists to make visible in review rather than easy to omit.
   */
  readonly limiter: PreAuthLimiter;
  readonly sleeper: PreAuthSleeper;
  /**
   * `SESSION_HMAC_KEY`. At least 32 bytes. Rotating it signs every user out immediately, which is
   * the intended emergency control (`0015` §A).
   */
  readonly sessionSigningKey: CryptoBytes;
  /**
   * `IDENTITY_LOOKUP_KEY`. At least 32 bytes.
   *
   * ===========================================================================================
   * IT MUST BE A DIFFERENT SECRET FROM `sessionSigningKey`, AND THIS IS NOT FASTIDIOUSNESS.
   * ===========================================================================================
   *
   * The two have OPPOSITE rotation properties, and sharing one value would silently destroy the
   * cheaper of them. Rotating `SESSION_HMAC_KEY` invalidates every live session — disruptive,
   * recoverable in one login, and exactly what you want available during an incident. Rotating
   * `IDENTITY_LOOKUP_KEY` is IRREVERSIBLE: every stored `identifier_hash` was computed under the
   * old key and cannot be recomputed, because the plaintext addresses are deliberately not stored
   * (`0006_principal_credential.sql`). If they were one value, the emergency "sign everybody out"
   * control would also permanently lock everybody out, and an operator would discover that during
   * the incident.
   *
   * They are therefore two bindings, and this file will not derive one from the other.
   */
  readonly identifierLookupKey: CryptoBytes;
  readonly evidence?: PreAuthEvidenceRecorder;
  readonly failureReporter?: PreAuthFailureReporter;
};

export type IdentityComposition = {
  /** For `ApiDependencies.principals`. Resolves a session credential into a sealed principal. */
  readonly principals: PrincipalResolver;
  /** For `ApiDependencies.preAuth`. The five entry points' admission rule, fully composed. */
  readonly preAuth: PreAuthDependencies;
  /**
   * For `ApiDependencies.sessionRoutes`. The Organization picker and selection
   * (`docs/decisions/0021`) — authenticated at the session level, with no tenant, no permission
   * and no Action pipeline.
   */
  readonly sessionRoutes: SessionRouteDependencies;
  /**
   * Exposed because the Organization picker and `selectOrganization` are reached through it, and
   * because `0015` leaves both to the client flow rather than to login. It is NOT put on
   * `ActionContext` and must not be: `control-plane-store.ts` property 4 turns on nothing in
   * `platform/core/action/**` or `apps/**` ever importing the control plane.
   */
  readonly sessions: SessionResolver;
};

export async function createIdentityComposition(
  input: IdentityCompositionInput,
): Promise<IdentityComposition> {
  // ---- The control-plane half. `0014` §C.5's resolution order lives inside this.
  //
  // THE SESSION LIFETIME IS STATED HERE, EXPLICITLY, WHICH IS WHAT `createSessionResolver`
  // REQUIRES. It has no default deliberately — "so a composition root has to state a value and a
  // reviewer can see which one it stated" — and the value is `0015` §B.1's twelve hours, held as
  // one exported constant so the session row's `expires_at` and the cookie's `Max-Age` cannot
  // drift apart.
  const sessions = createSessionResolver({
    store: input.store,
    authorization: input.authorization,
    admission: input.admission,
    ids: input.ids,
    clock: input.clock,
    sessionLifetimeMs: SESSION_LIFETIME_MS,
  });

  // ---- The credential half. Both keys are imported into `CryptoKey` objects here and the raw
  // bytes are not retained by anything below.
  const signer = await createSessionCredentialSigner(input.sessionSigningKey);
  const identifiers = await createHmacIdentifierHasher(input.identifierLookupKey);
  const verifier = await createCredentialVerifier({
    credentials: input.credentials,
    identifiers,
  });

  // ===========================================================================================
  // THE BUCKETER SHARES `IDENTITY_LOOKUP_KEY`, AND THE ARGUMENT FOR THAT IS BELOW RATHER THAN
  // ASSUMED. IT IS A JUDGEMENT CALL AND THE TEAM LEAD MAY OVERRIDE IT WITH A SIXTH SECRET.
  // ===========================================================================================
  //
  // Both primitives are HMAC-SHA-256 over the submitted identifier under the same key, so the
  // question that decides safety is whether the two can ever be asked to sign the SAME MESSAGE.
  // They cannot: `createHmacIdentifierHasher` signs `"dudo.identity.credential.v1<space><id>"`
  // and `createHmacIdentifierBucketer` signs `"<entryPointId><space><id>"`, where `entryPointId`
  // is one of five fixed literals, none of which is the credential label. The message spaces are
  // disjoint by construction, which is what domain separation means.
  //
  // THE FAILURE MODES ALSO DO NOT COMPOUND. Rotating the key destroys the credential lookup
  // permanently (see `identifierLookupKey` above); it merely re-shuffles bucket assignments for
  // the limiter, which is harmless and self-correcting within one 60-second window. Sharing
  // therefore adds no new irreversible outcome.
  //
  // WHAT IT BUYS: the identifier rate-limit level RUNS. Without a key, `dispatchPreAuthRequest`
  // announces `identifier_level_absent` on every request that would have used it and falls back
  // to the source level alone — which `pre-auth-admission.ts` records as leaving the online
  // credential-guessing hole open, "the one that matters". Shipping login with that level off, to
  // avoid provisioning a secret, would be the wrong trade.
  const identifierBucketer = await createHmacIdentifierBucketer(input.identifierLookupKey);

  // ONE CREDENTIAL READER, SHARED BY BOTH CLASSES. The session routes authenticate with exactly
  // the same reader the ordinary authenticated path uses (`docs/decisions/0021`): one credential,
  // one verifier, one set of carrier rules. A session route that accepted a credential the
  // Action path would reject — or the reverse — would be two authentication schemes wearing one
  // name.
  const credentials = createSessionCredentialReader(signer);

  return {
    principals: createSessionPrincipalResolver({ credentials, sessions }),
    sessionRoutes: {
      handlers: createSessionRouteHandlers({ sessions }),
      // The reader returns a session identifier and NOTHING ELSE — no organization, no principal,
      // no claim — so no implementation of it can move a tenant identifier from the request into
      // the platform. That property is why the session route class can authenticate without
      // building a principal.
      readSessionId: (headers) => credentials.read({ headers }),
    },
    preAuth: {
      clock: input.clock,
      limiter: input.limiter,
      sleeper: input.sleeper,
      handlers: createLoginHandlers({ verifier, sessions, signer }),
      evidence: input.evidence,
      identifierBucketer,
      failureReporter: input.failureReporter,
    },
    sessions,
  };
}
