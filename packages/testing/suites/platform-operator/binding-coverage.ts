/**
 * ===========================================================================================
 * THE CONFIRMATION BINDING'S TWO ENDS — CHECKED, RATHER THAN MAINTAINED BY A PERSON.
 * ===========================================================================================
 *
 * `m2-contracts` found the shape while deciding the tenant-admin challenge form:
 *
 * ```
 * confirmation-v1 CHALLENGE     parameters: a NESTED OBJECT, supplied by the CLIENT
 * confirmation-gate SUBMISSION  ( keys(body) \ {the three} ) ∪ names(pathTemplate(R))  — DERIVED
 * ```
 *
 * **`confirmation-gate.ts`'s own accepted ruling refuses that shape in terms:** *"two definitions
 * of the bound value is a binding that covers different things at the two ends."*
 *
 * ===========================================================================================
 * WHAT I MEASURED, AND IT MOVED THE FINDING
 * ===========================================================================================
 *
 * **There is ONE canonicaliser, not two.** `confirmation-service.ts:146` (issue) and `:210`
 * (spend) both call `canonicalizeParameters`. So the risk is not two implementations drifting —
 * **it is the two ends being handed different OBJECTS.**
 *
 * ```
 * issueChallenge(input)   canonicalises input.parameters  <- WHAT THE CLIENT SENT
 * verifyAndSpend(input)   canonicalises input.parameters  <- what splitConfirmedRequest DERIVED
 * ```
 *
 * **A mismatch fails CLOSED** — different objects, different HMAC, the spend is refused. So the
 * dangerous direction is not disagreement. **It is the derived key set being NARROWER than what
 * the operation acts on**, because then both ends agree on a binding that covers less than the
 * request does. That is precisely the `revokeOperatorInput` defect the gate's own comment
 * records: *"the parameters were the EMPTY OBJECT and a confirmation minted to revoke operator A
 * was spendable on operator B."*
 *
 * ===========================================================================================
 * ⚠ SO THE CHECKABLE PROPERTY IS ABOUT WHAT THE UNION OMITS — AND IT OMITS QUERY PARAMETERS
 * ===========================================================================================
 *
 * ```
 * keys(parameters) = ( keys(body) \ {the three} ) ∪ names(pathTemplate(R))
 *                                                   ^ no queryParameters term
 * ```
 *
 * **A confirmation-gated route carrying a query parameter would act on a value the binding does
 * not cover** — the human confirms one thing, the query says another, and both ends agree
 * because neither end ever saw it. **Same defect as the empty-object case, one field over.**
 *
 * **MEASURED TODAY: it holds, and it holds for a reason that is a property of the CORPUS rather
 * than of any check** — `§11a`, named in the prediction rather than discovered later:
 *
 * ```
 * platform routes                        22
 * carrying query parameters               5   — all `.list` reads
 * confirmation-gated (critical permission) 0   of those five
 * ```
 *
 * > **Critical operations are writes, and writes do not paginate.** That is why the property is
 * > true today, and it is exactly the kind of coincidence that stops being true the first time
 * > somebody adds a filter to a destructive operation — a `?dry_run=` or a `?scope=` on a delete.
 *
 * **The case below goes red on that day.** It is green now, and the green depends on a corpus
 * property that is stated here rather than assumed.
 *
 * ===========================================================================================
 * THE VACUITY QUESTION, ASKED BEFORE THE CASE WAS WRITTEN
 * ===========================================================================================
 *
 * *Would this pass against an implementation that ignored its input?* **A comparison of the two
 * canonicalisers would** — they are the same function, so feeding one object twice returns the
 * same string trivially and proves nothing. **That case was not written.** What is written
 * instead is a check on the KEY SET the derivation produces, which is where the two ends can
 * actually differ, and it is driven with a route whose path parameter makes the union non-empty.
 */

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';
import { requiresConfirmation } from '../../../../platform/core/confirmation/critical-permissions.ts';
import {
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
  splitConfirmedRequest,
} from '../../../../platform/core/confirmation/confirmation-gate.ts';

type Route = ReturnType<typeof platformRoutes>[number];

/** A route is gated when its permission is critical — it is not a field on the route. */
function isGated(route: Route): boolean {
  const permission = route.permission as { kind: string; permissionId?: string };
  return permission.kind === 'fixed' && permission.permissionId !== undefined
    ? requiresConfirmation(permission.permissionId)
    : false;
}

export function buildBindingCoverageSuite(): Suite {
  const suite = new TestSuite('confirmation — the binding covers what the operation acts on');

  suite.test('POPULATION — routes, query-carrying routes, and which are gated', () => {
    const routes = platformRoutes();
    const withQuery = routes.filter((route) => (route.queryParameters ?? []).length > 0);
    const gated = routes.filter(isGated);
    console.log(
      `      platform routes ${String(routes.length)} · carrying query parameters ${String(withQuery.length)} · ` +
        `confirmation-gated ${String(gated.length)}`,
    );
    for (const route of withQuery) {
      console.log(`        ${route.id.padEnd(40)} query=[${(route.queryParameters ?? []).join(', ')}]`);
    }
    // THE FLOOR. Zero gated routes makes the central assertion vacuous, and zero routes overall
    // means the registry reader broke — two different failures, both rendering as a clean pass.
    assertTrue(
      'floor: the route registry was read',
      routes.length >= 20,
      `${String(routes.length)} platform routes — the registry reader has stopped seeing the table.`,
    );
    assertTrue(
      'floor: some route is confirmation-gated, or the central assertion is vacuous',
      gated.length > 0,
      'NO platform route is confirmation-gated. The assertion below then holds over an empty set ' +
        'and says nothing — `requiresConfirmation` or the critical-permission set has changed.',
    );
  });

  suite.test(`${ISOLATION} a confirmation-gated route declares NO query parameter`, () => {
    // The binding's key set is `(body \ three) ∪ pathParams`. **A query parameter is in neither
    // term**, so a gated route carrying one acts on a value the human never confirmed and the
    // HMAC never covered — and BOTH ENDS AGREE, because neither saw it. Fails silently, on the
    // routes where silence is most expensive.
    const offenders = platformRoutes()
      .filter(isGated)
      .filter((route) => (route.queryParameters ?? []).length > 0)
      .map((route) => `${route.id} declares [${(route.queryParameters ?? []).join(', ')}]`);

    assertEqual(
      `${ISOLATION} no gated route carries a value outside the binding's key set`,
      offenders.join(' · '),
      '',
    );
  });

  suite.test('THE DERIVATION — the key set is body-minus-three UNION the path names, driven', () => {
    // Driving `splitConfirmedRequest` rather than restating its rule. A route with a path
    // parameter is chosen deliberately: with an empty path template the union degenerates to the
    // body and the case would pass against a derivation that ignored paths entirely — which is
    // the `revokeOperatorInput` defect this union was added to close.
    const body = {
      [CONFIRMATION_ID_FIELD]: 'cnf_0000000000000001',
      [REAUTH_DERIVED_VALUE_FIELD]: 'v'.repeat(43),
      [REAUTH_IDENTIFIER_FIELD]: 'someone@example.test',
      display_name: 'a body field',
    };
    const outcome = splitConfirmedRequest(body, { organization_id: 'org_from_the_path' }) as
      | { readonly ok: true; readonly value: { readonly parameters: Record<string, unknown> } }
      | { readonly ok: false; readonly error: unknown };

    assertTrue('the split succeeded', outcome.ok, `refused: ${JSON.stringify(outcome)}`);
    if (!outcome.ok) return;

    const keys = Object.keys(outcome.value.parameters).sort();
    assertEqual(
      'the body field survives and the path parameter is UNIONED in',
      keys.join(','),
      'display_name,organization_id',
    );
    for (const field of [CONFIRMATION_ID_FIELD, REAUTH_DERIVED_VALUE_FIELD, REAUTH_IDENTIFIER_FIELD]) {
      assertTrue(
        `${field} is excluded from the binding — it is the envelope, not the operation`,
        !keys.includes(field),
        `${field} is inside the bound parameters`,
      );
    }
  });

  suite.test('KNOWN-FAILING INPUT — a path parameter dropped from the union is the A-to-B defect', () => {
    // The realistic mutation, and it is the defect that actually shipped once: the union term
    // missing, so the parameters are the body alone. `platform-operators-v1` promises a
    // confirmation minted to revoke operator A cannot be spent on operator B, and the empty
    // parameter set is exactly how that promise was broken.
    const body = {
      [CONFIRMATION_ID_FIELD]: 'cnf_0000000000000001',
      [REAUTH_DERIVED_VALUE_FIELD]: 'v'.repeat(43),
      [REAUTH_IDENTIFIER_FIELD]: 'someone@example.test',
    };

    const withTarget = splitConfirmedRequest(body, { principal_id: 'prn_operator_a' }) as
      | { readonly ok: true; readonly value: { readonly parameters: Record<string, unknown> } }
      | { readonly ok: false; readonly error: unknown };
    assertTrue('control: the split succeeds with a path target', withTarget.ok, 'refused');
    if (!withTarget.ok) return;
    assertEqual(
      'the target IS in the binding — without this, A\'s confirmation is spendable on B',
      Object.keys(withTarget.value.parameters).join(','),
      'principal_id',
    );

    // And the mutant: the same body with NO path parameters yields an EMPTY parameter set, which
    // is the shipped defect. Asserted so the difference between the two is observed rather than
    // argued — a body carrying only the envelope binds NOTHING.
    const withoutTarget = splitConfirmedRequest(body, {}) as
      | { readonly ok: true; readonly value: { readonly parameters: Record<string, unknown> } }
      | { readonly ok: false; readonly error: unknown };
    if (withoutTarget.ok) {
      assertEqual(
        'a request whose only fields are the three envelope fields binds an EMPTY parameter set',
        Object.keys(withoutTarget.value.parameters).length,
        0,
      );
      console.log(
        '      the empty-binding state is REACHABLE when a route declares no path parameter and ' +
          'no body field beyond the envelope. It is safe only because every gated route today ' +
          'carries a path target — a property of the ROUTE TABLE, not of this function.',
      );
    }
  });

  return suite;
}
