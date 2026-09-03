/**
 * The bridge between the transport and the control plane — and the one place where what `0014`
 * §C decides meets what it deliberately does not.
 *
 * `PrincipalResolver` (`principal-resolver.ts`) takes an `AuthenticationInput` — headers — and
 * returns an `AuthenticatedPrincipal`. Part C can supply the second half of that: given a
 * session identifier, resolve the principal, the membership, and the Organization
 * (`session-resolution.ts`). It cannot supply the first half, because turning a credential in a
 * header into a session identifier is the credential format, and `0014` §C does not settle it:
 *
 *   "The identity provider itself — what issues the credential — is settled in the
 *    implementation only to the extent AZ2's constraints require."
 *
 * So the missing half is declared as a port with no implementation, exactly as
 * `createDenyAllPrincipalResolver` declares the whole. THE RESULT IS THE SAME FAIL-CLOSED STATE
 * THE PLATFORM IS ALREADY IN: with no `SessionCredentialReader` configured there is nothing to
 * compose, nothing authenticates, and Dudo serves nothing. Part C makes the pipeline behind
 * authentication real; it does not open a door.
 *
 * ===========================================================================================
 * THE RULE THIS FILE MUST NOT BREAK, restated from `principal-resolver.ts` because this is the
 * file where it would be broken
 * ===========================================================================================
 *
 *   "Note what is NOT here and may not be added: nothing that would let a caller name a tenant.
 *    MULTITENANCY_STANDARD.md §3 forbids deriving tenant from a request parameter, a header the
 *    caller controls, a hostname not resolved server-side to a session, or an unverified claim."
 *
 * `SessionCredentialReader` returns A SESSION IDENTIFIER AND NOTHING ELSE. It has no way to
 * return an Organization, a tenant, a role, or a claim, so no implementation of it — however it
 * is written, whatever it parses — can move a tenant identifier from the request into the
 * pipeline. The Organization comes from the session row and is re-validated against membership
 * on every request (`session-resolution.ts`, ruling 2).
 *
 * A caller-supplied Organization exists in exactly two operations in the platform, `issueSession`
 * and `selectOrganization`, and in both it is a hint validated against membership (§C.6). Neither
 * is on this path.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { failedPrecondition, unauthenticated } from '../kernel/errors.ts';
import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';
import type { AuthenticationInput, PrincipalResolver } from './principal-resolver.ts';
import type { SessionResolver } from './session-resolution.ts';

/**
 * Extracts a session identifier from an inbound request, or fails.
 *
 * ===========================================================================================
 * THERE IS NO IMPLEMENTATION OF THIS PORT IN THIS REPOSITORY, AND ONE MUST NOT BE ADDED WITHOUT
 * A DECISION RECORD.
 * ===========================================================================================
 *
 * Writing one means choosing a credential format — a bearer token, a signed cookie, an OIDC
 * exchange, a session identifier presented directly — and that choice determines whether
 * `session.session_id` is an identifier or a secret. If it is a secret, the schema needs a
 * verifier column before anything ships (`migrations/control-plane/0004_session.sql`).
 *
 * An agent cannot record that decision and cannot approve it. Supplying a permissive
 * implementation to unblock a feature would be selecting an unrecorded security mechanism, which
 * is the class of shortcut these rules exist to prevent.
 */
export type SessionCredentialReader = {
  /** `null` means no credential was presented. It is not an error and must not be logged as one. */
  read(input: AuthenticationInput): Promise<Result<string | null>>;
};

/**
 * Composes a credential reader with the control-plane session resolver into the
 * `PrincipalResolver` the pipeline already expects.
 *
 * WHY `organization-not-selected` BECOMES `failed_precondition` AND NOT `unauthenticated`.
 *
 * A valid session whose principal has chosen no Organization — or whose chosen Organization is
 * no longer enterable — is not a failure of authentication. The credential is good; there is
 * simply no tenant context, and the client's correct next move is to call the Organization
 * picker rather than to log in again. `unauthenticated` would send it round a loop that cannot
 * terminate.
 *
 * IT DISCLOSES NOTHING. The distinction is visible only to the holder of a valid session, and
 * only about that session's own state. No other principal, no Organization, and no record is
 * implicated — which is the test every error-code choice in this codebase is held to
 * (`kernel/errors.ts`).
 */
export function createSessionPrincipalResolver(dependencies: {
  readonly credentials: SessionCredentialReader;
  readonly sessions: SessionResolver;
}): PrincipalResolver {
  const { credentials, sessions } = dependencies;
  return {
    async resolve(input: AuthenticationInput): Promise<Result<AuthenticatedPrincipal>> {
      const credential = await credentials.read(input);
      if (!credential.ok) {
        return err(credential.error);
      }
      if (credential.value === null) {
        // No credential presented. `unauthenticated()` takes no arguments, so this is
        // byte-identical to the answer for a credential that was presented and rejected —
        // the same device `notFound()` uses, and the reason it is called rather than
        // constructed inline (`kernel/errors.ts`).
        return err(unauthenticated());
      }

      // No instant is passed. The session resolver holds the only clock, so nothing on this
      // path — including anything a transport adapter might later add — can influence the
      // expiry comparison. See `session-resolution.ts`, "one time source".
      const resolution = await sessions.resolve(credential.value);
      if (!resolution.ok) {
        return err(resolution.error);
      }
      if (resolution.value.kind === 'organization-not-selected') {
        return err(failedPrecondition());
      }
      return ok(resolution.value.principal);
    },
  };
}
