/**
 * ===========================================================================================
 * CAN A PRINCIPAL IN ORGANIZATION A REACH ORGANIZATION B THROUGH THE TENANT-ADMIN CLASS?
 * ===========================================================================================
 *
 * **No, and as of 2026-09-13 the reason changed from A CHECK to A CONSTRUCTION while this file
 * was being written.** That transition is the most useful thing here, so it is recorded rather
 * than smoothed over.
 *
 * ===========================================================================================
 * WHAT THIS FILE FIRST ASSERTED, AND WHY IT NO LONGER COMPILES
 * ===========================================================================================
 *
 * The first version drove `resolve(PRN_A, ORG_B)` with two strings and asserted a refusal. It
 * was testing a real property: `findActiveMembership(A-principal, B)` finds nothing, so the
 * resolver refuses. **That is a CHECK**, and `0044` §3a claimed the class was safe *"BY
 * CONSTRUCTION, NOT BY A CHECK"* — a sentence true of platform operators, who hold zero
 * membership rows, and **not true of a tenant principal in A asking about B**, which the wording
 * did not distinguish (`architecture.md` §3b: a dismissal must name the party it means).
 *
 * **`core-agent` then made the sentence true.** `resolve`'s second parameter is now an
 * `AuthenticatedOrganizationId`, and its only producer is:
 *
 * ```ts
 * sealAuthenticatedOrganizationId(principal: AuthenticatedPrincipal): AuthenticatedOrganizationId
 *   -> { value: principal.organizationId, principalId: principal.principalId }
 * ```
 *
 * > **It reads the Organization off the principal.** A caller authenticated in A **cannot
 * > construct an identifier naming B** — there is no parameter to pass one through. The old
 * > assertions stopped compiling, with `TS2345: Argument of type 'string' is not assignable`.
 *
 * **`§11a`: a test asserting something the type forbids is a test that can never fail, and
 * casting around the error to make it compile converts a compile-time guarantee into a runtime
 * assertion that can never fire.** So they are not cast around. They are replaced by assertions
 * about the property that now carries the weight, and the layer is named.
 *
 * ===========================================================================================
 * THE LAYERS, RANKED — `architecture.md` §3a, and the top one is new today
 * ===========================================================================================
 *
 * ```
 * THE SEAL          a caller cannot NAME another Organization      omission does not compile
 * THE BINDING       a sealed id spent under a different principal  consume…() throws
 * THE MEMBERSHIP    no active row for (principal, organization)    forbidden()
 * THE OPERATOR TEST a platform operator, above the membership read forbidden()
 * ```
 *
 * **Only the top layer is a construction. The other three are checks, and all four are driven
 * below** — because a construction can be removed by a refactor that compiles, and the checks
 * beneath it are what make that survivable.
 *
 * ===========================================================================================
 * WHAT THIS FILE DOES NOT REACH
 * ===========================================================================================
 *
 * - **No route.** `TENANT_ADMIN_ROUTE_COUNT` is 0, so nothing here proves a REQUEST from A is
 *   refused. Pinned below so the day routes land, this goes red and the behavioural half is
 *   written rather than assumed.
 * - **No custom roles.** `0007` D16's four constraints are unbuilt.
 * - **And the fixtures have `security-agent`'s shape**: four seed roles exist and **not one has
 *   ever been evaluated against a tenant-admin route.** *"The separations are what you built;
 *   they are not yet what protects you."*
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import type { Result } from '../../../../platform/core/kernel/result.ts';
import { ok } from '../../../../platform/core/kernel/result.ts';
import { MEMBERSHIP_ROLES } from '../../../../platform/core/authorization/roles.ts';
import { sealAuthenticatedPrincipal } from '../../../../platform/core/tenancy/tenant-context.ts';
import type { AuthenticatedOrganizationId } from '../../../../platform/core/tenant-admin/authenticated-organization.ts';
import { sealAuthenticatedOrganizationId } from '../../../../platform/core/tenant-admin/authenticated-organization.ts';
import type {
  TenantAdminAuthority,
  TenantAdminAuthorityStore,
  TenantAdminMembership,
} from '../../../../platform/core/tenant-admin/tenant-admin-authority.ts';
import { createTenantAdminAuthorityResolver } from '../../../../platform/core/tenant-admin/tenant-admin-authority.ts';
import { TENANT_ADMIN_ROUTE_COUNT } from '../../../../platform/core/tenant-admin/tenant-admin-routes.ts';

const ORG_A = 'org_alpha_isolation';
const ORG_B = 'org_beta_isolation';
const PRN_A = 'prn_member_of_alpha';
const PRN_B = 'prn_member_of_beta';
const PRN_OPERATOR = 'prn_platform_operator';

/** An authenticated principal, sealed the way the real pipeline seals one. */
function principal(principalId: string, organizationId: string): Parameters<typeof sealAuthenticatedOrganizationId>[0] {
  return sealAuthenticatedPrincipal({
    principalId,
    principalType: 'user',
    organizationId,
    authorizedBusinessIds: [],
    grants: { grants: [] },
    onBehalfOfPrincipalId: null,
  }) as Parameters<typeof sealAuthenticatedOrganizationId>[0];
}

function membership(
  organizationId: string,
  principalId: string,
  storedRole: string | null = 'owner',
  organizationStatus: 'active' | 'suspended' = 'active',
): TenantAdminMembership {
  return { principalId, organizationId, storedRole, organizationStatus };
}

/** Answers honestly: the key is the PAIR, so a missing row is missing rather than refused. */
function honestStore(
  rows: readonly TenantAdminMembership[],
  operators: readonly string[] = [],
): TenantAdminAuthorityStore {
  return {
    findActiveMembership(principalId: string, organization: AuthenticatedOrganizationId) {
      const organizationId = (organization as unknown as { value: string }).value;
      return Promise.resolve(
        ok(rows.find((row) => row.principalId === principalId && row.organizationId === organizationId) ?? null),
      ) as Promise<Result<TenantAdminMembership | null>>;
    },
    principalIsPlatformOperator(principalId: string): Promise<Result<boolean>> {
      return Promise.resolve(ok(operators.includes(principalId)));
    },
  } as unknown as TenantAdminAuthorityStore;
}

type Outcome = { readonly ok: true; readonly value: TenantAdminAuthority } | { readonly ok: false; readonly error: unknown };

async function attempt(run: () => Promise<unknown>): Promise<{ readonly threw: Error | null; readonly outcome: Outcome | null }> {
  try {
    return { threw: null, outcome: (await run()) as Outcome };
  } catch (cause) {
    return { threw: cause instanceof Error ? cause : new Error(String(cause)), outcome: null };
  }
}

export function buildAuthorityIsolationSuite(): Suite {
  const suite = new TestSuite('tenant-admin — can Organization A reach Organization B?');

  suite.test('NOT RUN — the behavioural half. No route in this class is reachable', () => {
    console.log(
      `      TENANT_ADMIN_ROUTE_COUNT = ${String(TENANT_ADMIN_ROUTE_COUNT)}. Every case below drives ` +
        'the AUTHORITY RESOLVER directly, because there is no request to make.',
    );
    assertEqual(
      'PIN: zero routes. When this moves, the BEHAVIOURAL isolation cases are owed and this file ' +
        'is not sufficient',
      TENANT_ADMIN_ROUTE_COUNT,
      0,
    );
  });

  // -----------------------------------------------------------------------------------------
  // LAYER 1 — THE SEAL. The construction, and the one that is new today.
  // -----------------------------------------------------------------------------------------
  suite.test(`${ISOLATION} THE SEAL — a principal in A cannot NAME Organization B`, () => {
    // The whole property, and it needs no resolver: the only producer reads the Organization off
    // the principal, so the value is not a caller's to choose. There is no negative case to write
    // because there is no input that expresses one — which is the point, and is why the runtime
    // assertions this file used to carry were deleted rather than cast around.
    const sealed = sealAuthenticatedOrganizationId(principal(PRN_A, ORG_A));
    assertEqual(`${ISOLATION} the sealed identifier names ORG_A`, (sealed as unknown as { value: string }).value, ORG_A);
    assertTrue(
      `${ISOLATION} and it names ORG_B nowhere`,
      !JSON.stringify(sealed).includes(ORG_B),
      `the sealed value mentions ORG_B: ${JSON.stringify(sealed)}`,
    );
    assertEqual(
      'and it carries the principal it was read from — the binding layer 2 checks',
      (sealed as unknown as { principalId: string }).principalId,
      PRN_A,
    );
  });

  suite.test('THE SEAL — every seed role seals only its OWN Organization, derived from the union', () => {
    // `0043` §3 doubled the role set. The seal does not consult a role at all, and asserting that
    // is worth more than assuming it: a future seal that took a role into account would be a seal
    // whose output depends on privilege.
    for (const role of MEMBERSHIP_ROLES) {
      const sealed = sealAuthenticatedOrganizationId(principal(`prn_${role}`, ORG_A));
      assertEqual(`${role} seals ORG_A and nothing else`, (sealed as unknown as { value: string }).value, ORG_A);
    }
    assertEqual(
      'PIN: four seed roles — move deliberately when 0043 §3 changes',
      [...MEMBERSHIP_ROLES].sort().join(','),
      'admin,business-admin,member,owner',
    );
  });

  // -----------------------------------------------------------------------------------------
  // LAYER 2 — THE BINDING. A sealed id is bound to the principal it was read from.
  // -----------------------------------------------------------------------------------------
  suite.test(`${ISOLATION} THE BINDING — a sealed id minted for A cannot be spent under another principal`, async () => {
    // The seal stops you naming another Organization. It does NOT, by itself, stop a sealed id
    // being passed alongside somebody else's principal id — that is a separate hole and
    // `consumeAuthenticatedOrganizationId` is what closes it.
    //
    // This is the case the seal alone cannot cover, which is why layer 1 is not the whole answer.
    const sealedForA = sealAuthenticatedOrganizationId(principal(PRN_A, ORG_A));
    const resolver = createTenantAdminAuthorityResolver(honestStore([membership(ORG_A, PRN_A), membership(ORG_A, PRN_B)]));

    const control = await attempt(() => resolver.resolve(PRN_A, sealedForA));
    assertTrue('control: the id resolves under the principal it was sealed for', control.outcome?.ok === true, `${String(control.threw?.message)}`);

    const mismatched = await attempt(() => resolver.resolve(PRN_B, sealedForA));
    assertTrue(
      `${ISOLATION} spending A's sealed identifier under principal B is refused`,
      mismatched.threw !== null || mismatched.outcome?.ok === false,
      "principal B resolved an authority using an identifier sealed from A's session. The seal " +
        'binds the Organization to the principal precisely so the two cannot be recombined.',
    );
  });

  // -----------------------------------------------------------------------------------------
  // LAYERS 3 AND 4 — the checks beneath the construction. Still driven, because a construction
  // can be removed by a refactor that compiles and these are what make that survivable.
  // -----------------------------------------------------------------------------------------
  suite.test('CONTROL — a member of A resolves an authority for A', async () => {
    const resolver = createTenantAdminAuthorityResolver(honestStore([membership(ORG_A, PRN_A)]));
    const outcome = await attempt(() => resolver.resolve(PRN_A, sealAuthenticatedOrganizationId(principal(PRN_A, ORG_A))));
    assertTrue('an authority is issued', outcome.outcome?.ok === true, `refused: ${JSON.stringify(outcome)}`);
    if (outcome.outcome?.ok !== true) return;
    // `organizationId` on the authority is the SEALED value, not a string — so the identifier a
    // handler receives is itself unforgeable and cannot be re-pointed downstream.
    assertEqual(
      'and it names ORG_A',
      (outcome.outcome.value.organizationId as unknown as { value: string }).value,
      ORG_A,
    );
  });

  suite.test(`${ISOLATION} EVERY refusal reason collapses to ONE value — four causes, one error`, async () => {
    // If any cause produced a distinguishable value, a caller could probe: *is this Organization
    // suspended, or am I not a member, or is my role unknown?* Each answer is a fact about state
    // the caller is not entitled to read. The seal does not cover this at all — it is a property
    // of the error path.
    const sealedA = sealAuthenticatedOrganizationId(principal(PRN_A, ORG_A));
    const causes: Record<string, Outcome | null> = {
      'no membership row': (await attempt(() =>
        createTenantAdminAuthorityResolver(honestStore([])).resolve(PRN_A, sealedA))).outcome,
      'organization suspended': (await attempt(() =>
        createTenantAdminAuthorityResolver(honestStore([membership(ORG_A, PRN_A, 'owner', 'suspended')])).resolve(PRN_A, sealedA))).outcome,
      'stored role unrecognised': (await attempt(() =>
        createTenantAdminAuthorityResolver(honestStore([membership(ORG_A, PRN_A, 'a-role-this-build-does-not-know')])).resolve(PRN_A, sealedA))).outcome,
      'principal is a platform operator': (await attempt(() =>
        createTenantAdminAuthorityResolver(honestStore([membership(ORG_A, PRN_A)], [PRN_A])).resolve(PRN_A, sealedA))).outcome,
    };

    for (const [cause, outcome] of Object.entries(causes)) {
      assertTrue(`control: "${cause}" is refused`, outcome !== null && !outcome.ok, `"${cause}" SUCCEEDED or threw`);
    }
    const distinct = new Set(Object.values(causes).map((outcome) => JSON.stringify(outcome)));
    assertEqual(
      `${ISOLATION} all four causes produce ONE error value — ${String(Object.keys(causes).length)} probed`,
      distinct.size,
      1,
    );
  });

  suite.test('§3a — a PLATFORM OPERATOR is refused even holding a membership row', async () => {
    // `0024`'s forbidden state, resolved deliberately. The operator test sits ABOVE the membership
    // read, so the row does not save it — and this is the one population §3a's "by construction"
    // wording was already true of, since an operator holds zero rows in a correct database.
    const resolver = createTenantAdminAuthorityResolver(honestStore([membership(ORG_A, PRN_OPERATOR)], [PRN_OPERATOR]));
    const outcome = await attempt(() =>
      resolver.resolve(PRN_OPERATOR, sealAuthenticatedOrganizationId(principal(PRN_OPERATOR, ORG_A))));
    assertTrue(
      `${ISOLATION} a platform operator gets no tenant-admin authority, membership row or not`,
      outcome.outcome?.ok === false || outcome.threw !== null,
      'a platform operator obtained a tenant-admin authority. 0024: a membership row IS the bypass.',
    );
  });

  suite.test(`${ISOLATION} A "HELPFUL ADAPTER" CANNOT PRODUCE A CROSS-TENANT AUTHORITY — and the reason CHANGED`, async () => {
    // ⚠ THIS CASE'S PREMISE WAS WITHDRAWN UNDER IT, AND THE CONCLUSION SURVIVES FOR A DIFFERENT
    // REASON. `workflow.md` §12: *if the conclusion still holds, RE-DERIVE it and say so, rather
    // than leaving a live assertion propped up by a fact that is gone.*
    //
    //   WAS   `organizationId: membership.organizationId` — the authority took the ROW's value,
    //         so a store answering about the wrong Organization produced an authority naming it.
    //         The case asserted the row won.
    //   NOW   `organizationId: organization` — the authority carries the SEALED PARAMETER.
    //
    // **Read alone that looks weaker: the resolver no longer cross-checks the row against the
    // request.** It is not, because of what the parameter now is: **a sealed identifier can only
    // ever name the principal's OWN Organization**, so "the requested one" and "the principal's
    // own" became the same value. Carrying the request is safe precisely because the request is
    // no longer a caller's to choose.
    //
    // ⚠ AND MY FIRST RE-DERIVATION WAS ALSO WRONG, WHICH IS WHY THE CODE WAS OPENED AGAIN. I
    // wrote that the row-versus-request comparison was GONE and that the seal had replaced it.
    // **Both survive.** `tenant-admin-authority.ts` carries, after the role narrowing:
    //
    //     if (membership.organizationId !== organizationId) { return err(forbidden()); }
    //
    // with a comment saying the unwrapped value exists *"only to compare"*. **So the design is
    // seal AND check, not seal INSTEAD OF check** — the construction stops a caller naming
    // another Organization, and the comparison stops a STORE answering about one. Two different
    // adversaries, and neither layer covers the other's.
    //
    // I nearly shipped a comment asserting a defence had been withdrawn when it had been added
    // to. **The test failing is what sent me back to the file** — `§11a`'s third cause: the input
    // was impossible for a reason nobody had written down, and reading the reason beat casting.
    const helpful = {
      findActiveMembership: () => Promise.resolve(ok(membership(ORG_B, PRN_A))),
      principalIsPlatformOperator: () => Promise.resolve(ok(false)),
    } as unknown as TenantAdminAuthorityStore;
    const outcome = await attempt(() =>
      createTenantAdminAuthorityResolver(helpful).resolve(PRN_A, sealAuthenticatedOrganizationId(principal(PRN_A, ORG_A))));
    assertTrue(
      `${ISOLATION} a store answering about ORG_B is REFUSED, not trusted`,
      outcome.outcome?.ok === false,
      'a store that returned a membership row from ORG_B produced an authority. The resolver ' +
        'compares the row against the sealed request precisely so a wrong answer from the ' +
        'adapter cannot become an authority.',
    );

    // THE CONTROL, without which the case above is satisfied by a resolver that refuses every
    // store: the SAME double answering about the right Organization must succeed.
    const honest = {
      findActiveMembership: () => Promise.resolve(ok(membership(ORG_A, PRN_A))),
      principalIsPlatformOperator: () => Promise.resolve(ok(false)),
    } as unknown as TenantAdminAuthorityStore;
    const control = await attempt(() =>
      createTenantAdminAuthorityResolver(honest).resolve(PRN_A, sealAuthenticatedOrganizationId(principal(PRN_A, ORG_A))));
    assertTrue('control: the same double answering about ORG_A succeeds', control.outcome?.ok === true, 'refused');
  });

  return suite;
}
