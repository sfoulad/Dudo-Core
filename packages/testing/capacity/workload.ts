/**
 * ===========================================================================================
 * A REALISTIC BUSINESS DAY, DRIVEN THROUGH THE SHIPPED CODE AND COUNTED.
 * ===========================================================================================
 *
 * Every operation below runs the real dispatcher, the real pipeline, the real adapters and the
 * real migrations. **Nothing reads a declared constant** — the constants are compared against
 * these figures afterwards, which is the comparison `0030` says is owed.
 */

import { costOfStatements, countingProxy, schemaRowWriteCost } from './measure.ts';
import type { WriteBreakdown } from './measure.ts';
import { classifyStatements } from './reads.ts';
import type { OperationReads } from './reads.ts';

import {
  ORG_ALPHA,
  PRN_ADMIN,
  PRN_TENANT_OWNER,
  SESSION_ADMIN,
  TENANT_OWNER_IDENTIFIER,
  createPlatformWorld,
  onboardingRequest,
  successfulCallFor,
} from '../harness/platform-fixture.ts';
import type { PlatformWorld } from '../harness/platform-fixture.ts';
import {
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
} from '../../../platform/core/confirmation/confirmation-gate.ts';

export type OperationCost = {
  readonly name: string;
  /** Billed control-plane row-writes, from the live schema. */
  readonly controlPlaneRowWrites: number;
  /** Billed tenant-database row-writes. */
  readonly tenantRowWrites: number;
  /**
   * Calls into the admission port and the request coordinator.
   *
   * IN DEPLOYMENT EACH IS ONE DURABLE OBJECT REQUEST — the day ledger is a single global
   * instance, the coordinator one per Organization. See `measure.ts::countingProxy` for why this
   * is an exact count of calls and an inference about requests.
   */
  readonly ledgerCalls: number;
  /** One HTTP request per operation, unless the operation is several. */
  readonly workerRequests: number;
  readonly controlBreakdown: WriteBreakdown;
  readonly tenantBreakdown: WriteBreakdown;
  /** Every SELECT this operation emitted, classified by query plan. See `reads.ts`. */
  readonly controlReads: OperationReads;
  readonly tenantReads: OperationReads;
  /** Anything this measurement could not see. Carried into the report, never dropped. */
  readonly caveats: readonly string[];
};

type Measured = {
  readonly world: PlatformWorld;
  readonly ledger: { count: number };
};

/**
 * ===========================================================================================
 * *** A FAILED OPERATION LOOKS EXACTLY LIKE A FREE ONE TO A COST COUNTER. ***
 * ===========================================================================================
 *
 * This measured `issue a session` at ZERO row-writes on its first run. The call was failing with
 * `unavailable` because the harness passed the wrong field names, and a refusal writes nothing —
 * so the model would have reported logins as free and every capacity figure would have been too
 * high, with nothing red anywhere.
 *
 * It is the same family as everything else caught today: **a check whose silence is
 * indistinguishable from its success.** So every operation asserts it SUCCEEDED before its cost is
 * believed, and a measurement program that cannot perform an operation says so instead of costing
 * it at nothing.
 */
function mustSucceed(what: string, result: { readonly ok: boolean; readonly error?: unknown }): void {
  if (!result.ok) {
    throw new Error(
      `CANNOT MEASURE '${what}': the operation failed with ${JSON.stringify(result.error)}. ` +
        'A failed operation writes nothing and would be reported as costing nothing, which makes ' +
        'the capacity model too optimistic in exactly the direction that matters.',
    );
  }
}

/**
 * Builds a world whose admission port counts its calls.
 *
 * THE COUNTER WRAPS THE PORT RATHER THAN REPLACING IT, so every reservation still goes through
 * the real in-process ledger and still succeeds or defers for the real reasons. A stub would
 * measure the harness.
 */
async function measuredWorld(): Promise<Measured> {
  const ledger = { count: 0 };
  const world = await createPlatformWorld({
    wrapAdmission: (inner) =>
      countingProxy(inner, () => {
        ledger.count += 1;
      }),
  });
  return { world, ledger };
}

function costs(world: PlatformWorld, database: 'control' | 'tenant') {
  const harness = database === 'control' ? world.control : world.tenant;
  const cache = new Map<string, number>();
  return (table: string): number => {
    const known = cache.get(table);
    if (known !== undefined) {
      return known;
    }
    let cost: number;
    try {
      cost = schemaRowWriteCost(harness, table);
    } catch {
      // A table in the OTHER database. Returning 0 here would silently under-count; the caller
      // measures each database separately, so this branch means the statement was not this
      // database's and contributes nothing to this side's total.
      cost = 0;
    }
    cache.set(table, cost);
    return cost;
  };
}

async function measure(
  name: string,
  workerRequests: number,
  caveats: readonly string[],
  run: (world: PlatformWorld) => Promise<void>,
): Promise<OperationCost> {
  const { world, ledger } = await measuredWorld();
  try {
    const controlFrom = world.control.statements.length;
    const tenantFrom = world.tenant.statements.length;
    ledger.count = 0;
    await run(world);
    const controlBreakdown = costOfStatements(world.control, controlFrom, costs(world, 'control'));
    const tenantBreakdown = costOfStatements(world.tenant, tenantFrom, costs(world, 'tenant'));
    return {
      name,
      controlPlaneRowWrites: controlBreakdown.totalBilled,
      tenantRowWrites: tenantBreakdown.totalBilled,
      ledgerCalls: ledger.count,
      workerRequests,
      controlBreakdown,
      tenantBreakdown,
      controlReads: classifyStatements(name, world.control, controlFrom),
      tenantReads: classifyStatements(name, world.tenant, tenantFrom),
      caveats,
    };
  } finally {
    world.close();
  }
}

/**
 * The operations a real day is made of.
 *
 * **THE MIX IS NOT MEASURED HERE — IT IS A PARAMETER OF THE MODEL.** This measures what ONE of
 * each costs; how many of each a business does per day is an assumption, and `model.ts` makes it
 * an input rather than burying it.
 */
export async function measureOperations(): Promise<OperationCost[]> {
  const results: OperationCost[] = [];

  results.push(
    await measure('onboard an Organization', 1, [], async (world) => {
      const request = await onboardingRequest();
      mustSucceed(
        'onboard an Organization',
        await world.call('platform.organizations.create', {
          sessionId: SESSION_ADMIN,
          bodyText: request.bodyText,
        }),
      );
    }),
  );

  results.push(
    await measure(
      'issue a session (login)',
      1,
      ['The login ROUTE is not driven — this is `issueSession` through the real resolver, which is ' +
        'the write half. Credential verification is a read and costs no row-writes.'],
      async (world) => {
        // FIELD NAMES ARE THE PORT'S: `verifiedPrincipalId` and `requestedOrganizationId`. The
        // first version passed `principalId`/`organizationId`, the call failed with `unavailable`,
        // and the measurement recorded ZERO row-writes — a failed operation looks exactly like a
        // free one to a cost counter. `mustSucceed` below is why that cannot happen silently again.
        mustSucceed(
          'issue a session',
          await world.sessions.issueSession({
            verifiedPrincipalId: PRN_TENANT_OWNER,
            requestedOrganizationId: null,
          }),
        );
      },
    ),
  );

  results.push(
    await measure('revoke a session (logout)', 1, [], async (world) => {
      mustSucceed('revoke a session', await world.sessions.revokeSession('ses_tenantowner0001'));
    }),
  );

  results.push(
    await measure('resolve a member by identifier', 1, [], async (world) => {
      const call = await successfulCallFor('platform.organizations.members.resolve', world);
      mustSucceed(
        'resolve a member',
        await world.call('platform.organizations.members.resolve', {
          sessionId: SESSION_ADMIN,
          bodyText: call.bodyText,
          pathParams: call.pathParams,
        }),
      );
    }),
  );

  results.push(
    await measure('read the platform audit feed', 1, [], async (world) => {
      mustSucceed(
        'read the platform audit feed',
        await world.call('platform.audit.list', { sessionId: SESSION_ADMIN }),
      );
    }),
  );

  results.push(
    await measure("read one Organization's audit feed", 1, [], async (world) => {
      mustSucceed(
        "read an Organization's audit feed",
        await world.call('platform.organizations.audit.list', {
          sessionId: SESSION_ADMIN,
          pathParams: { organization_id: ORG_ALPHA },
        }),
      );
    }),
  );

  results.push(
    await measure(
      'reset a credential',
      1,
      [
        'THE SESSION REVOCATION IS ONE STATEMENT DELETING MANY ROWS. This counts statements, so ' +
          'the figure is a LOWER BOUND: a target with N live sessions bills N rows plus their ' +
          'index rows, not one. An under-count of cost is an OVER-estimate of capacity.',
      ],
      async (world) => {
        const parameters = {
          principal_id: PRN_TENANT_OWNER,
          target_identifier: TENANT_OWNER_IDENTIFIER,
          derived_value: 'A'.repeat(43),
        };
        const issued = await world.confirmations.issueChallenge({
          principalId: PRN_ADMIN,
          sessionId: SESSION_ADMIN,
          actionId: 'platform.credentials.reset',
          permissionId: 'core.credential.reset',
          parameters,
          locale: 'en',
        });
        mustSucceed('issue a reset challenge', issued);
        mustSucceed(
          'reset a credential',
          await world.call('platform.credentials.reset', {
            sessionId: SESSION_ADMIN,
            bodyText: JSON.stringify({
              ...parameters,
              [CONFIRMATION_ID_FIELD]: (issued as { value: { confirmationId: string } }).value
                .confirmationId,
              [REAUTH_DERIVED_VALUE_FIELD]: await world.operatorDerivedValue(),
              [REAUTH_IDENTIFIER_FIELD]: world.operatorIdentifier,
            }),
          }),
        );
      },
    ),
  );

  results.push(
    await measure(
      'request a confirmation challenge',
      1,
      [],
      async (world) => {
        const call = await successfulCallFor('platform.confirmations.request', world);
        mustSucceed(
          'request a confirmation challenge',
          await world.call('platform.confirmations.request', {
            sessionId: SESSION_ADMIN,
            bodyText: call.bodyText,
          }),
        );
      },
    ),
  );

  return results;
}
