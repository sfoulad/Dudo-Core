/**
 * ===========================================================================================
 * THE FOUR BOUNDS ON THE BOOTSTRAP EXCEPTION TO `0007` D11.
 * `docs/decisions/0025` decision 4 · contract `platform-operator-v1`,
 * `theBootstrapExceptionToD11` · `organization-onboarding-v1.schema.json`.
 * ===========================================================================================
 *
 * D11 condition 1 is the rule that makes the permission model non-escalating: *"you cannot grant
 * what you do not have."* Onboarding violates it on its face — a platform operator creates an
 * Organization's first membership at `owner`, a role carrying seven `customers.*` permissions the
 * operator holds and could never hold. `0025` declares that a BOUNDED bootstrap exception and
 * gives it four bounds, *"because an unbounded exception to D11 is a hole in the permission model
 * wearing the word bootstrap."*
 *
 *   1. Only at Organization creation.
 *   2. Exactly one membership, at exactly one role, `owner`. NOT A ROLE NAMED IN THE REQUEST.
 *   3. Unavailable the moment the Organization has any membership row.
 *   4. No other platform operation may grant a tenant permission, ever.
 *
 * ===========================================================================================
 * WHAT CAN AND CANNOT BE TESTED TODAY, STATED EXACTLY
 * ===========================================================================================
 *
 * `organization-onboarding-v1` HAS NO IMPLEMENTATION. There is no `platform.organizations.create`
 * route, no handler and no code that writes an `organization_membership` row. Bounds 1 and 3 are
 * statements about the behaviour of an operation that does not exist, so they are registered as
 * SKIPPED with the reason, never as passing.
 *
 * WHAT *CAN* BE TESTED IS THE CONTRACT, AND IT IS THE HALF THAT WOULD BE LOST SILENTLY.
 * `architecture-agent` found that bound 3 *"holds trivially, because the operation creates the
 * Organization and never sees an existing membership — which is exactly why it could be lost
 * without anyone noticing. A bound that is true by accident is not a bound."* It closed the
 * request schema so there is no field to carry the widening.
 *
 * *** THE CASES BELOW ARE THAT TRIPWIRE. *** "Add an admin to an existing tenant" is a
 * reasonable-sounding future request that would break bound 2 and bound 3 in one edit, and it
 * would arrive as a `role` field on the onboarding request. A `role` field appearing there is a
 * CONTRACT REGRESSION TO FAIL, not a change to accommodate — so this suite reads the shipped
 * schema off disk and fails on it.
 *
 * Bound 4 IS mechanically checkable today, from the other end: Core's platform envelope declares
 * six permissions and none of them is a permission any tenant role holds. That is asserted here.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { PLATFORM_PERMISSION_ENVELOPE } from '../../../../platform/core/platform/platform-permissions.ts';
import { MEMBERSHIP_ROLES, grantsForRole } from '../../../../platform/core/authorization/roles.ts';
import type { MembershipRole } from '../../../../platform/core/authorization/roles.ts';

const CONTRACT_DIRECTORY = fileURLToPath(
  new URL('../../../../packages/contracts/core/platform/', import.meta.url),
);

type JsonSchema = {
  readonly $defs?: Record<string, JsonSchemaNode>;
};

type JsonSchemaNode = {
  readonly type?: string;
  readonly additionalProperties?: boolean;
  readonly required?: readonly string[];
  readonly properties?: Record<string, unknown>;
};

function readSchema(fileName: string): JsonSchema {
  return JSON.parse(readFileSync(`${CONTRACT_DIRECTORY}${fileName}`, 'utf8')) as JsonSchema;
}

/**
 * Field names that would carry a tenant grant into a platform request.
 *
 * `role` IS THE ONE THAT MATTERS AND THE REST ARE ITS NEIGHBOURS. A widening does not have to be
 * called `role` to be one — `permissions`, `memberships` and `grants` each convert the bounded
 * exception into a general grant mechanism just as completely.
 */
const GRANT_CARRYING_FIELD_NAMES: readonly string[] = Object.freeze([
  'role',
  'roles',
  'permission',
  'permissions',
  'membership',
  'memberships',
  'grant',
  'grants',
  'scope',
  'scopes',
]);

export function buildBootstrapBoundsSuite(): Suite {
  const suite = new Suite('Platform — the bootstrap exception to 0007 D11 (0025 decision 4)');

  suite.test('the onboarding request declares exactly four fields and closes the object', () => {
    const schema = readSchema('organization-onboarding-v1.schema.json');
    const input = schema.$defs?.onboardOrganizationInput;
    assertTrue('the input definition exists', input !== undefined, 'onboardOrganizationInput is absent');

    assertEqual(
      'additionalProperties is closed — an undeclared field is refused rather than ignored',
      input!.additionalProperties,
      false,
    );
    assertEqual(
      'the declared properties are exactly the four',
      Object.keys(input!.properties ?? {}).sort().join(','),
      'admin_identifier,derived_value,first_workspace_name,template_id',
    );
    assertEqual(
      'and all four are required',
      [...(input!.required ?? [])].sort().join(','),
      'admin_identifier,derived_value,first_workspace_name,template_id',
    );
  });

  suite.test('no platform request input declares a field that could carry a tenant grant', () => {
    // BOUND 2 AND BOUND 3'S TRIPWIRE, applied across every platform contract rather than only to
    // onboarding — bound 4 says NO OTHER platform operation may grant a tenant permission either,
    // so credential reset and the Template operations are held to the same line.
    const offences: string[] = [];
    for (const fileName of readdirSync(CONTRACT_DIRECTORY)) {
      if (!fileName.endsWith('.schema.json')) {
        continue;
      }
      const schema = readSchema(fileName);
      for (const [definitionName, definition] of Object.entries(schema.$defs ?? {})) {
        // INPUTS ONLY. `whoamiOutput` legitimately reports the caller's own `permissions`, and
        // that is a description of authority rather than a grant of one.
        if (!definitionName.endsWith('Input')) {
          continue;
        }
        for (const property of Object.keys(definition.properties ?? {})) {
          if (GRANT_CARRYING_FIELD_NAMES.includes(property)) {
            offences.push(`${fileName} · ${definitionName} · ${property}`);
          }
        }
      }
    }
    assertEqual(
      `${ISOLATION} a role named in a platform request would widen a bounded exception into a ` +
        'general grant mechanism',
      offences.join(' | '),
      '',
    );
  });

  suite.test('no platform request input declares a caller-chosen tenant identifier', () => {
    // A caller-chosen `organization_id` is what bound 1 would be lost through: an operation that
    // could name an EXISTING Organization is an operation that can grant into one.
    const offences: string[] = [];
    for (const fileName of readdirSync(CONTRACT_DIRECTORY)) {
      if (!fileName.endsWith('.schema.json')) {
        continue;
      }
      const schema = readSchema(fileName);
      for (const [definitionName, definition] of Object.entries(schema.$defs ?? {})) {
        if (!definitionName.endsWith('Input')) {
          continue;
        }
        for (const property of Object.keys(definition.properties ?? {})) {
          if (property === 'organization_id' || property === 'tenant_id') {
            offences.push(`${fileName} · ${definitionName} · ${property}`);
          }
        }
      }
    }
    assertEqual(
      `${ISOLATION} onboarding never sees an Organization it did not create`,
      offences.join(' | '),
      '',
    );
  });

  suite.test('no platform contract response declares a plaintext credential field', () => {
    // A TRIPWIRE FOR A PROPERTY THAT WAS LOST ONCE AND CORRECTED ON 2026-09-05.
    // `onboardOrganizationOutput` required a plaintext `initial_password` while the prose beside
    // it said the server never sees one — an implementer satisfying that `required` list would
    // have had to build the design `0015` §D and `0026` exist to prevent. The correction removed
    // the field and deliberately left no tombstone property, because a placeholder under
    // `additionalProperties: false` is a PERMITTED OPTIONAL credential field, which is the same
    // defect one size smaller. This case fails if either form comes back.
    const forbidden = ['password', 'initial_password', 'secret', 'credential', 'token', 'verifier'];
    const offences: string[] = [];
    for (const fileName of readdirSync(CONTRACT_DIRECTORY)) {
      if (!fileName.endsWith('.schema.json')) {
        continue;
      }
      const schema = readSchema(fileName);
      for (const [definitionName, definition] of Object.entries(schema.$defs ?? {})) {
        if (!definitionName.endsWith('Output')) {
          continue;
        }
        for (const property of Object.keys(definition.properties ?? {})) {
          if (forbidden.includes(property)) {
            offences.push(`${fileName} · ${definitionName} · ${property}`);
          }
        }
      }
    }
    assertEqual(
      `${ISOLATION} no platform response carries a credential, in required or optional form`,
      offences.join(' | '),
      '',
    );
  });

  suite.test('bound 4: no permission in the platform envelope is one a tenant role holds', () => {
    const envelope = PLATFORM_PERMISSION_ENVELOPE.declared.map((entry) => entry.permissionId);
    const tenantHeld = new Set<string>();
    for (const role of MEMBERSHIP_ROLES) {
      for (const grant of grantsForRole(role as MembershipRole).grants) {
        tenantHeld.add(grant.permissionId);
      }
    }
    const overlap = envelope.filter((permissionId) => tenantHeld.has(permissionId));
    assertEqual(
      `${ISOLATION} a platform route cannot exercise a tenant capability`,
      overlap.join(','),
      '',
    );
    assertTrue(
      'the control: the tenant roles really do hold permissions',
      tenantHeld.size > 0,
      'no tenant permission was found, so the comparison above was vacuous',
    );
  });

  suite.test('bound 4: no platform route declares a tenant-scoped permission', () => {
    const nonPlatform = PLATFORM_PERMISSION_ENVELOPE.declared.filter(
      (entry) => entry.scope !== 'platform',
    );
    assertEqual(
      `${ISOLATION} every declaration in this class is at platform scope`,
      nonPlatform.map((entry) => entry.permissionId).join(','),
      '',
    );
  });

  // ---------------------------------------------------------------------------------------
  // Not run, with the reason recorded. Never reported as passing.
  // ---------------------------------------------------------------------------------------

  suite.skip(
    'bound 1: onboarding creates a membership only in the operation that creates the Organization',
    'organization-onboarding-v1 has no implementation: no platform.organizations.create route, ' +
      'no handler, and no code anywhere that writes an organization_membership row. This is a ' +
      'statement about the behaviour of an operation that does not exist. NOT RUN.',
  );

  suite.skip(
    'bound 2: onboarding creates exactly one membership, at exactly the role `owner`',
    'Same reason. The CONTRACT half of this bound — that no role can be named in the request — ' +
      'IS tested above and is green; the BEHAVIOURAL half needs the operation to exist. NOT RUN.',
  );

  suite.skip(
    'bound 3: onboarding is unavailable once the Organization has any membership row',
    'Same reason, and architecture-agent recorded that this bound "holds trivially, because the ' +
      'operation creates the Organization and never sees an existing membership". The schema ' +
      'tripwire above is what stops it being lost silently; the runtime check cannot be written ' +
      'until there is a runtime. NOT RUN.',
  );

  return suite;
}
