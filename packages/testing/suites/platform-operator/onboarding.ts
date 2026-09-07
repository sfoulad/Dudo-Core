/**
 * ===========================================================================================
 * ORGANIZATION ONBOARDING. `organization-onboarding-v1` · `docs/decisions/0026` · `0025` D4.
 * ===========================================================================================
 *
 * **THE ONLY OPERATION IN DUDO THAT BRINGS A TENANT INTO EXISTENCE**, and the only route in the
 * platform class whose handler reaches a tenant store. Before it, the answer to "how does Dudo
 * acquire a customer" was that an operator ran SQL by hand.
 *
 * `bootstrap-bounds.ts` holds `0025` decision 4's four bounds on `0007` D11 — the permission-model
 * half. THIS FILE HOLDS THE REST OF THE OPERATION, and the four properties below are the ones that
 * would do real harm if they were wrong:
 *
 *   1. **THE RESPONSE CONTAINS NO CREDENTIAL FIELD OF ANY KIND.** `0026` closed `ON-5` as option
 *      B: the console generates the password and derives from it, and the server never sees one.
 *      The schema previously required an `initial_password` while the prose beside it said the
 *      server never sees a password — an implementer satisfying that `required` list would have
 *      had to build option A, which is the exact design `0015` §D exists to prevent. Asserted as
 *      an absence over the WHOLE response rather than as "the field we removed is gone", because
 *      the next one will have a different name.
 *
 *   2. **THE CREATED ADMIN AUTHENTICATES WITH THE CONSOLE-DERIVED VALUE ON THE FIRST ATTEMPT.**
 *      Three derivations have to agree — the console's, Core's second derivation at storage, and
 *      the login path's verification — and if any one of them differs by a byte the account is
 *      created and permanently unreachable, with no error anywhere. **This is the property a
 *      fixture with a typed-out `derived_value` cannot test**, which is why
 *      `platform-fixture.ts::onboardingRequest` derives through the shipped console KDF.
 *
 *   3. **A `201` WITH `warnings` IS A SUCCESS, NOT A FAILURE.** The contract's ruling, and the
 *      reason is that failing would leave a customer that exists, cannot be entered, and needs a
 *      credential reset to rescue — *"the ambiguity is the harm."* A caller treating a populated
 *      `warnings` array as an error is the defect this asserts against.
 *
 *   4. **THE OPERATOR CANNOT ENTER WHAT IT CREATED.** `onboarding.ts`: *"the operator gains no
 *      membership, its session's `active_organization_id` stays null, and it can never resolve
 *      that handle again through any route."* That is what makes the bootstrap exception safe
 *      rather than convenient, and it is a tenant-isolation claim, labelled as one.
 *
 * ALL DATA IS SYNTHETIC. The generated passwords are per-call random values, are never printed,
 * and are never asserted on — only round-tripped.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_CONFLICT,
  EXPECTED_NOT_FOUND,
  EXPECTED_QUOTA_EXCEEDED,
  ORG_ALPHA,
  PRN_ADMIN,
  SESSION_ADMIN,
  TEMPLATE_NOWHERE,
  TEMPLATE_SEEDED,
  TENANT_BINDING_NAME,
  createPlatformWorld,
  onboardingRequest,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import { platformRoutes } from '../../../../platform/core/platform/platform-routes.ts';
import { unguardedMembershipInserts } from './membership-write-guard.ts';
import { err, ok } from '../../../../platform/core/kernel/result.ts';
import { unavailable } from '../../../../platform/core/kernel/errors.ts';
import { ONBOARDING_CONTROL_PLANE_ROW_WRITES } from '../../../../platform/core/onboarding/onboarding-service.ts';

type OnboardingResponse = {
  readonly organization_id: string;
  readonly admin_principal_id: string;
  readonly workspace_id: string | null;
  readonly warnings: readonly string[];
};

/**
 * Anything in a response object that could be a credential, looked for by SHAPE rather than by
 * name.
 *
 * A NAME LIST WOULD ONLY EVER CATCH THE FIELD THAT WAS ALREADY REMOVED. What makes a value
 * dangerous here is that it is a secret a client would show a human — so the check is: no string
 * value in the response is long, high-entropy and unaccounted for, and no KEY reads like a
 * credential. Both halves, because either alone is evadable.
 */
const CREDENTIAL_KEY_FRAGMENTS: readonly string[] = Object.freeze([
  'password',
  'secret',
  'credential',
  'token',
  'derived',
  'verifier',
  'salt',
  'key',
  'passphrase',
  'pin',
  'otp',
  'reset',
]);

function credentialShapedKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return [];
  }
  const found: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (CREDENTIAL_KEY_FRAGMENTS.some((fragment) => key.toLowerCase().includes(fragment))) {
      found.push(here);
    }
    found.push(...credentialShapedKeys(nested, here));
  }
  return found;
}

export function buildOnboardingSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — Organization onboarding (organization-onboarding-v1)');

  suite.test('the route answers 201, and 201 is what the table declares', () => {
    // The dispatcher returns a `Result`, not a status, so the status lives in the route table and
    // is asserted there. It is 201 EVEN WITH A NON-EMPTY `warnings` ARRAY — see the case below.
    const route = platformRoutes().find((entry) => entry.id === 'platform.organizations.create');
    assertTrue('the route is registered', route !== undefined, 'no onboarding route in the table');
    assertEqual('a resource was created, so 201', route!.successStatus, 201);
  });

  suite.test('a successful onboarding creates the six objects and returns three identifiers', async () => {
    const world = await make();
    try {
      const request = await onboardingRequest();
      const created = expectOk(
        'the onboarding succeeds',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: request.bodyText,
        }),
      ) as OnboardingResponse;

      assertEqual('no warnings on a complete success', created.warnings.length, 0);
      assertTrue(
        'a workspace identifier is returned',
        typeof created.workspace_id === 'string' && created.workspace_id.length > 0,
        `workspace_id was ${String(created.workspace_id)}`,
      );

      // ---- THE FIVE CONTROL-PLANE ROWS, each looked for individually. A count would pass on
      // five rows in the wrong tables.
      const organizations = world
        .controlRows('organization')
        .filter((row) => row.organization_id === created.organization_id);
      assertEqual('the organization row exists', organizations.length, 1);
      assertEqual('and it is active', organizations[0]!.status, 'active');

      const directory = world
        .controlRows('tenant_directory')
        .filter((row) => row.organization_id === created.organization_id);
      assertEqual('the tenant_directory row exists', directory.length, 1);
      assertEqual(
        'and it names the binding the composition root configured, with no fallback',
        directory[0]!.binding_name,
        TENANT_BINDING_NAME,
      );

      const principals = world
        .controlRows('principal')
        .filter((row) => row.principal_id === created.admin_principal_id);
      assertEqual('the admin principal row exists', principals.length, 1);
      assertEqual('the first admin is a person, not a service account', principals[0]!.principal_type, 'user');

      assertEqual(
        'a credential row exists for the admin',
        world
          .controlRows('principal_credential')
          .filter((row) => row.principal_id === created.admin_principal_id).length,
        1,
      );

      // ---- THE TEMPLATE REFERENCE, WHICH IS THE ONE THING `0013` EXISTS FOR.
      //
      // `0012_template.sql` said in normative voice that until onboarding added the reference the
      // Template capability was *"COMPLETE AND INERT, and contract TM-4 requires it to be
      // reported that way rather than as 'business types now work'."* This is the assertion that
      // decides which of those two sentences is true, and it is the only one that can — a green
      // Template suite proves the catalogue works and says nothing about whether anything uses it.
      assertEqual(
        'the created Organization records which Template it was created from',
        organizations[0]!.template_id,
        TEMPLATE_SEEDED,
      );

      // ---- AND THE TENANT-SIDE ROW, in the OTHER database.
      assertEqual(
        'the first Workspace row exists in the tenant database',
        world.tenantRows('business').filter((row) => row.business_id === created.workspace_id).length,
        1,
      );
      assertEqual(
        'and the tenant-side audit record was written',
        world
          .tenantRows('audit_event')
          .filter((row) => row.action_id === 'platform.organizations.create').length,
        1,
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE RESPONSE CARRIES NO CREDENTIAL FIELD OF ANY KIND', async () => {
    const world = await make();
    try {
      const request = await onboardingRequest();
      const created = expectOk(
        'the onboarding succeeds',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: request.bodyText,
        }),
      ) as Record<string, unknown>;

      // ---- 1. NO KEY READS LIKE A CREDENTIAL, at any depth.
      assertEqual(
        `${ISOLATION} no field in the response could carry a secret`,
        credentialShapedKeys(created).join(','),
        '',
      );

      // ---- 2. THE EXACT KEY SET, so a field that evades the fragment list is still caught.
      // NOT A TOMBSTONE ANYWHERE: `onboarding.ts` records that a placeholder left in the shape
      // would be a permitted optional field, *"the same defect one size smaller"*.
      assertEqual(
        `${ISOLATION} the response is exactly four fields, all identifiers or tokens`,
        Object.keys(created).sort().join(','),
        'admin_principal_id,organization_id,warnings,workspace_id',
      );

      // ---- 3. AND THE VALUE THE CONSOLE SENT DOES NOT COME BACK. The strongest form: the
      // server received `derived_value` and must not echo it, in any field, at any depth.
      const rendered = JSON.stringify(created);
      assertTrue(
        `${ISOLATION} the submitted derived value is nowhere in the response`,
        !rendered.includes(request.derivedValue),
        'the response echoes the value the console derived, which a log or a bug report would ' +
          'then contain',
      );
      assertTrue(
        `${ISOLATION} and neither is the password, which the server never had`,
        !rendered.includes(request.password),
        'the response contains the generated password, which means the server saw one',
      );
    } finally {
      world.close();
    }
  });

  suite.test('THE CREATED ADMIN AUTHENTICATES ON THE FIRST ATTEMPT, with the console-derived value', async () => {
    const world = await make();
    try {
      const request = await onboardingRequest();
      const created = expectOk(
        'the onboarding succeeds',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: request.bodyText,
        }),
      ) as OnboardingResponse;

      // ===================================================================================
      // THE ROUND TRIP. Console derives -> Core derives again and stores -> login verifies.
      // ===================================================================================
      //
      // FIRST ATTEMPT, NOT "eventually". There is no retry, no second enrolment step and no
      // activation: `0026` option B means the credential is complete the moment the batch
      // commits, and the operator hands the human a password that must work immediately.
      const verified = expectOk(
        'the credential the operation wrote is one the login path accepts',
        await world.authenticate(request.identifier, request.derivedValue),
      ) as { kind: string; principalId?: string };
      assertEqual('it verified', verified.kind, 'verified');
      assertEqual(
        `${ISOLATION} and it resolved to the principal this operation created, not another`,
        verified.principalId,
        created.admin_principal_id,
      );

      // ---- THE NEGATIVE CONTROL. Without it, "verified" could mean the verifier accepts
      // anything. A different derived value for the same identifier must be refused.
      const wrong = await onboardingRequest({ adminIdentifier: request.identifier });
      const refused = expectOk(
        'a wrong derived value still produces a well-formed answer',
        await world.authenticate(request.identifier, wrong.derivedValue),
      ) as { kind: string };
      assertEqual(
        `${ISOLATION} a DIFFERENT derivation of the same identifier is refused`,
        refused.kind,
        'refused',
      );
    } finally {
      world.close();
    }
  });

  suite.test('A 201 WITH `warnings` IS A SUCCESS, NOT A FAILURE', async () => {
    // ===================================================================================
    // THE TENANT SIDE IS MADE UNREACHABLE, WHICH IS THE ONLY WAY TO REACH THIS PATH.
    // ===================================================================================
    //
    // Steps 1-4 are the operation and they commit to the control plane; steps 6-7 write to a
    // SECOND database and there is no batch that commits both. `onboarding-service.ts` states
    // the consequence: *"from here on, nothing fails the operation."*
    //
    // The resolver is wrapped to refuse, which is the shape of a tenant database that is
    // unreachable at the moment a customer is created. No production file is edited.
    const world = await make({
      wrapResolver: () => ({ async resolve() { return err(unavailable()); } }),
    });
    try {
      const request = await onboardingRequest();
      const created = expectOk(
        'IT IS STILL A SUCCESS — the Organization exists and cannot be unmade',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: request.bodyText,
        }),
      ) as OnboardingResponse;

      assertEqual(
        'both warnings are reported, because the two steps are one write',
        [...created.warnings].sort().join(','),
        'first_workspace_not_created,tenant_audit_record_not_written',
      );
      assertEqual('and workspace_id is null rather than a fabricated identifier', created.workspace_id, null);

      // ---- THE HALF THAT MAKES THE RULING CORRECT: the customer really does exist and is
      // usable. Reporting this as a failure would leave exactly this state with an operator who
      // believes nothing happened.
      assertEqual(
        'the Organization exists',
        world.controlRows('organization').filter((row) => row.organization_id === created.organization_id).length,
        1,
      );
      assertEqual(
        'the admin exists, at owner',
        world
          .controlRows('organization_membership')
          .filter((row) => row.organization_id === created.organization_id)
          .map((row) => String(row.role))
          .join(','),
        'owner',
      );
      const verified = expectOk(
        'AND THE ADMIN CAN STILL SIGN IN — the credential committed with the rest',
        await world.authenticate(request.identifier, request.derivedValue),
      ) as { kind: string };
      assertEqual(
        'so the warning describes a missing Workspace, not a broken account',
        verified.kind,
        'verified',
      );

      // ---- AND NOTHING LANDED IN THE TENANT DATABASE. The two warnings are honest.
      assertEqual('no Workspace row', world.tenantRows('business').length, 0);
      assertEqual('no tenant audit row', world.tenantRows('audit_event').length, 0);
    } finally {
      world.close();
    }
  });

  suite.test('THE OPERATOR CANNOT ENTER THE ORGANIZATION IT CREATED', async () => {
    const world = await make();
    try {
      const created = expectOk(
        'the onboarding succeeds',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: (await onboardingRequest()).bodyText,
        }),
      ) as OnboardingResponse;

      assertEqual(
        `${ISOLATION} the operator gained NO membership in what it created`,
        world
          .controlRows('organization_membership')
          .filter((row) => row.principal_id === PRN_ADMIN).length,
        0,
      );
      const sessions = world
        .controlRows('session')
        .filter((row) => row.principal_id === PRN_ADMIN);
      assertTrue('the operator has sessions', sessions.length > 0, 'no session rows');
      assertTrue(
        `${ISOLATION} and every one of them still has a null active_organization_id`,
        sessions.every((row) => row.active_organization_id === null),
        JSON.stringify(sessions),
      );

      // AND THE OPERATOR'S OWN ENUMERATION STILL RETURNS NOTHING. `0024`: an operator's
      // Organization picker is empty. Creating one must not put it in reach.
      const picker = expectOk(
        'the picker answers',
        await world.sessions.listEnterableOrganizations(SESSION_ADMIN),
      ) as readonly unknown[];
      assertEqual(
        `${ISOLATION} creating an Organization did not make it selectable`,
        picker.length,
        0,
      );
      assertTrue(
        'and the created Organization is a real one, so the empty answer is not vacuous',
        created.organization_id.length > 0,
        'no organization was created',
      );
    } finally {
      world.close();
    }
  });

  suite.test('an unknown template_id is not_found — the plain case, with no budget pressure', async () => {
    const world = await make();
    try {
      const before = world.controlRows('organization').length;
      expectError(
        'an unknown Template is not_found, and honestly so — every operator may enumerate them',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: (await onboardingRequest({ templateId: TEMPLATE_NOWHERE })).bodyText,
        }),
        EXPECTED_NOT_FOUND,
      );
      assertEqual(
        `${ISOLATION} and no Organization was created`,
        world.controlRows('organization').length,
        before,
      );
    } finally {
      world.close();
    }
  });

  suite.test(
    'VALIDATION HAPPENS BEFORE RESERVATION: an unknown template_id answers not_found even when ' +
      'the onboarding reservation would be refused',
    async () => {
      // ===================================================================================
      // THE ORDERING PROPERTY, AND THE OBVIOUS TEST FOR IT WOULD FAIL A CORRECT IMPLEMENTATION.
      // ===================================================================================
      //
      // `onboarding-service.ts` states it as tested rather than preferred: *"with the
      // per-principal daily budget exhausted, a request naming an unknown `template_id` must
      // answer 404 and not 429. Reversed ordering is a defect even though both are refusals — it
      // spends budget on a request that was never going to succeed, and it tells the operator the
      // wrong thing about why."*
      //
      // **EXHAUSTING THE WHOLE BUDGET CANNOT TEST THAT.** P4 makes `dispatchPlatformRoute` write
      // an audit record on every route from the SAME per-principal ceiling, so a world with no
      // budget answers `unavailable` to everything — including the 404. `core-agent` measured
      // exactly this, and it is why the cost is split 10-and-2 instead of reserved as 12 in one
      // place. A case built the obvious way would report a correct implementation as broken.
      //
      // SO ONLY THE ONBOARDING-SIZED RESERVATION IS REFUSED. The audit recorder's 2 still
      // succeeds, which is what lets the answer be a 404 rather than an `unavailable` about
      // something else entirely.
      const reserved: number[] = [];
      const world = await make({
        wrapAdmission: (inner) => ({
          async reserve(request) {
            reserved.push(request.estimatedRowWrites);
            if (request.estimatedRowWrites === ONBOARDING_CONTROL_PLANE_ROW_WRITES) {
              // ALL THREE FIELDS. `resumeAfterMs` was missing on the first version of this
              // wrapper and `npm run typecheck` caught it — the gate working on the very code
              // that was added to test something else. At runtime the omission would have been
              // invisible: nothing on this path reads it, so the case would have gone green while
              // the wrapper produced a shape the port does not have.
              return ok({ kind: 'deferred' as const, resumeAfterMs: 0, retryAfterSeconds: 0 });
            }
            return inner.reserve(request);
          },
        }),
      });
      try {
        // ---- THE POSITIVE CONTROL FIRST. The wrapper really does refuse the onboarding
        // reservation, so the 404 below is the ordering and not the wrapper doing nothing.
        expectError(
          'a VALID request is refused with quota_exceeded under this wrapper',
          await world.call('platform.organizations.create', {
            sessionId: SESSION_ADMIN,
            bodyText: (await onboardingRequest()).bodyText,
          }),
          EXPECTED_QUOTA_EXCEEDED,
        );
        assertTrue(
          'and the onboarding reservation was actually attempted',
          reserved.includes(ONBOARDING_CONTROL_PLANE_ROW_WRITES),
          `the sizes reserved were: ${reserved.join(',')}`,
        );

        // ---- THE CASE. Same wrapper, same refused reservation, unknown Template.
        reserved.length = 0;
        expectError(
          `${ISOLATION} an unknown Template is 404, not the quota answer`,
          await world.call('platform.organizations.create', {
            sessionId: SESSION_ADMIN,
            bodyText: (await onboardingRequest({ templateId: TEMPLATE_NOWHERE })).bodyText,
          }),
          EXPECTED_NOT_FOUND,
        );

        // ---- AND THE STRONGER FORM, which the error code alone does not give: the reservation
        // was never ATTEMPTED. A implementation that reserved, failed, and then happened to
        // return 404 would pass on the code and would still be spending budget on a request that
        // was never going to succeed — which is the half of the contract's sentence about cost.
        assertEqual(
          `${ISOLATION} no onboarding-sized capacity was even requested for a doomed request`,
          reserved.filter((size) => size === ONBOARDING_CONTROL_PLANE_ROW_WRITES).length,
          0,
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test('an identifier that already exists is a conflict, and nothing is overwritten', async () => {
    const world = await make();
    try {
      const first = await onboardingRequest();
      expectOk(
        'the first onboarding succeeds',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: first.bodyText,
        }),
      );
      const credentialsBefore = world.controlRows('principal_credential');

      // The SAME identifier, a DIFFERENT password. The attack this refuses is an operator
      // silently replacing an existing account's credential by "re-onboarding" it.
      expectError(
        'the second is refused with conflict',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: (await onboardingRequest({ adminIdentifier: 'first.admin@example.invalid' }))
            .bodyText,
        }),
        EXPECTED_CONFLICT,
      );

      assertEqual(
        `${ISOLATION} no credential row was added or replaced`,
        JSON.stringify(world.controlRows('principal_credential')),
        JSON.stringify(credentialsBefore),
      );
      // AND THE ORIGINAL CREDENTIAL STILL WORKS. A conflict that had partially overwritten the
      // stored verifier would leave the first admin locked out with no error anywhere.
      const verified = expectOk(
        'the first admin can still sign in',
        await world.authenticate(first.identifier, first.derivedValue),
      ) as { kind: string };
      assertEqual('unchanged', verified.kind, 'verified');
    } finally {
      world.close();
    }
  });

  suite.test('the operator log records the Organization and nothing about what it contains', async () => {
    const world = await make();
    try {
      const request = await onboardingRequest();
      const created = expectOk(
        'the onboarding succeeds',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: request.bodyText,
        }),
      ) as OnboardingResponse;

      const rows = world.actionRows();
      assertEqual('exactly one operator action record', rows.length, 1);
      assertEqual('it names the Organization', rows[0]!.target_id, created.organization_id);
      assertEqual('as an organization target', rows[0]!.target_kind, 'organization');

      // `0025` decision 5: the record may name an identifier and may never carry the CONTENTS of
      // what was touched. Asserted over the whole row, so a column added later is covered.
      const rendered = JSON.stringify(rows[0]);
      for (const [label, secret] of [
        ['the admin identifier', request.identifier],
        ['the Workspace name', 'North Workspace'],
        ['the derived value', request.derivedValue],
        ['the generated password', request.password],
      ] as const) {
        assertTrue(
          `${ISOLATION} the operator log does not contain ${label}`,
          !rendered.includes(secret),
          `the platform_operator_action row contains ${label}, which is content rather than an ` +
            'identifier',
        );
      }
    } finally {
      world.close();
    }
  });

  suite.test('M-1: the membership INSERT onboarding emits carries the guard', async () => {
    // ===================================================================================
    // ONBOARDING IS A SECOND PRODUCER OF `organization_membership` INSERTS, AND
    // `membership-write-guard.ts` COULD NOT SEE IT.
    // ===================================================================================
    //
    // That suite asserts *"EVERY statement the run emitted that inserts a membership carries the
    // guard"* — over the statements ITS OWN run emitted. Its header records the reason its
    // positive control exists: *"Nothing in the platform route class writes a membership, so a run
    // that only exercised the routes would emit no membership INSERT at all and the assertion
    // would pass over an empty set."*
    //
    // **THAT SENTENCE STOPPED BEING TRUE ON 2026-09-05.** `platform.organizations.create` reaches
    // `createOrganizationWithFirstAdmin`, which inserts a membership — in a different run, from a
    // different call site, through a different batch. An unguarded INSERT there would have been
    // caught by nothing. The matcher is imported rather than restated, so the two cannot drift.
    const world = await make();
    try {
      const before = world.control.statements.length;
      expectOk(
        'the onboarding succeeds',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: (await onboardingRequest()).bodyText,
        }),
      );
      const emitted = world.control.statements.slice(before);

      // THE POSITIVE CONTROL FIRST, for the same reason that suite gives: if the call emitted no
      // membership INSERT at all, the assertion below would pass over an empty set and mean
      // nothing.
      const membershipInserts = emitted.filter((statement) =>
        /insert\s+into\s+organization_membership/i.test(statement.sql),
      );
      assertEqual(
        'the onboarding really did emit exactly one membership INSERT',
        membershipInserts.length,
        1,
      );
      assertEqual(
        `${ISOLATION} and it carries the mutual-exclusion guard`,
        unguardedMembershipInserts(emitted).join(' · '),
        '',
      );
    } finally {
      world.close();
    }
  });

  suite.test('a tenant principal cannot onboard, and neither can a moderator', async () => {
    const world = await make();
    try {
      const body = (await onboardingRequest()).bodyText;
      const before = world.controlRows('organization').length;
      for (const session of ['ses_tenantowner0001', 'ses_moderator_00001']) {
        const answer = await world.call('platform.organizations.create', {
          sessionId: session,
          bodyText: body,
        });
        assertTrue(
          `${ISOLATION} ${session} is refused`,
          !answer.ok,
          `a caller who is not a platform-admin created an Organization: ${JSON.stringify(answer)}`,
        );
      }
      assertEqual(
        `${ISOLATION} and no Organization was created by either`,
        world.controlRows('organization').length,
        before,
      );
      // The seeded Organizations are untouched, which is the isolation claim rather than a count.
      assertEqual(
        'ORG_ALPHA still has its two memberships',
        world
          .controlRows('organization_membership')
          .filter((row) => row.organization_id === ORG_ALPHA).length,
        2,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
