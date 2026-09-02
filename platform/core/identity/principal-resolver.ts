/**
 * Authentication, as a port with no implementation.
 *
 * AZ2 IS OPEN AND IS NOT DECIDED HERE. AUTHORIZATION_STANDARD.md records it plainly:
 * "Authentication mechanism — sessions, tokens, OAuth/OIDC — is unrecorded. Authorization
 * assumes an authenticated principal but cannot produce one." API_STANDARD.md AS3 says the
 * same for the public API. The Customer Directory contract lists it first among the
 * dependencies it cannot satisfy itself, and states that it "is written so it does not
 * depend on which scheme is chosen".
 *
 * So this file declares the shape of the answer and produces none. Choosing a scheme —
 * inventing a bearer-token format, trusting a header, reading an unverified claim — would
 * be selecting an unrecorded security mechanism to unblock an App, which is exactly the
 * class of shortcut the rules exist to prevent. An agent cannot record that decision and
 * cannot approve it.
 *
 * THE CONSEQUENCE, STATED RATHER THAN SOFTENED: with no resolver configured, every request
 * is `unauthenticated` and the Customer Directory serves nothing. That is fail-closed and
 * it is the correct state for a platform whose identity layer does not exist. It is not a
 * defect in this slice and must not be "fixed" by supplying a permissive default resolver,
 * which would be an authentication bypass wearing the word default.
 *
 * `createDenyAllPrincipalResolver` exists so the composition root is honest rather than
 * absent: the pipeline is wired, the port is present, and the answer is no.
 */

import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';
import type { Result } from '../kernel/result.ts';
import { err } from '../kernel/result.ts';
import { unauthenticated } from '../kernel/errors.ts';

/**
 * The transport-independent view of an inbound request that authentication may read.
 *
 * Note what is NOT here and may not be added: nothing that would let a caller name a
 * tenant. MULTITENANCY_STANDARD.md §3 forbids deriving tenant from a request parameter,
 * a header the caller controls, a hostname not resolved server-side to a session, or an
 * unverified claim. The resolver's job is to verify a credential and look up the
 * principal's Organization from Dudo's own record — never to read one off the request.
 */
export type AuthenticationInput = {
  readonly headers: ReadonlyMap<string, string>;
};

export type PrincipalResolver = {
  resolve(input: AuthenticationInput): Promise<Result<AuthenticatedPrincipal>>;
};

export function createDenyAllPrincipalResolver(): PrincipalResolver {
  return {
    async resolve(): Promise<Result<AuthenticatedPrincipal>> {
      return err(unauthenticated());
    },
  };
}
