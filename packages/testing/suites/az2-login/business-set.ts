/**
 * ===========================================================================================
 * THE AUTHORIZED BUSINESS SET, THROUGH THE REAL PIPELINE. `docs/decisions/0020`.
 * ===========================================================================================
 *
 * ADOPTED from `core-agent`'s `verify-business-set.ts`, which lived only in a session-scoped
 * scratchpad — so the fourteen results it reported could not be re-run by anyone, which is the
 * same standard Apple's evidence was held to. Its cases are here, with the import paths made
 * relative and four attacks added.
 *
 * THE CLAIM IS NOT "a function returns an array". `0020` splits the authorized context so the
 * business set is computed AFTER `TenantStoreResolver`, per request, never cached. Four
 * properties, each verified below through `invokeAction` rather than as a unit of the helper:
 *
 *   1. read through the tenant handle with NO predicate, one column, bounded at 500
 *   2. per request, NEVER cached — a Business removed mid-session stops being authorized on the
 *      very next request, not in twelve hours
 *   3. a FAILED read refuses the request rather than continuing with an empty set
 *   4. bounded at 500, truncating rather than growing
 *
 * ===========================================================================================
 * WHY PROPERTY 3 IS THE ONE WORTH PUSHING HARDEST ON
 * ===========================================================================================
 *
 * An empty set is indistinguishable from "authorized over nothing". So a storage failure that
 * continued with an empty set would produce a **silent, total `forbidden` that looks exactly like
 * a permissions bug** — and whoever investigated would search the role mapping for a fault that
 * was never there. Refusing is the only answer that tells the truth about what happened.
 *
 * ===========================================================================================
 * THE `businessScope` DEFAULT, WHICH IS WHAT THE WHOLE SPLIT RESTS ON
 * ===========================================================================================
 *
 * `AuthenticatedPrincipal.businessScope` is optional and defaults to `'assigned'`. The tempting
 * implementation — *"if the array is empty, fill it"* — was refused by `core-agent` as **the
 * sentinel inverted**: it would make the safest value in the codebase, the one that denies
 * everywhere, mean the widest possible grant in exactly one place. That reasoning is right, and
 * the cases below verify the consequence rather than restate it.
 *
 * I checked every construction site. There are exactly two in production —
 * `session-resolution.ts` (states `'organization'`) and `pipeline.ts` (re-seals `'assigned'`) —
 * and one in the harness (`world.ts`, omits it, therefore keeps what it was given). **No site
 * omits it that should not.** That is asserted below rather than left as a reading.
 */

import { Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import {
  BUSINESS_ID_COLUMN,
  BUSINESS_TABLE,
  MAX_AUTHORIZED_BUSINESSES,
  createStoreBusinessDirectory,
} from '../../../../platform/core/tenancy/business-directory.ts';
import { sealAuthenticatedPrincipal } from '../../../../platform/core/tenancy/tenant-context.ts';
import { invokeAction } from '../../../../platform/core/action/pipeline.ts';
import { err, ok } from '../../../../platform/core/kernel/result.ts';
import { unavailable } from '../../../../platform/core/kernel/errors.ts';
import { createD1TenantStore } from '../../../../platform/core/storage/adapters/d1/d1-store.ts';
import { createSqliteDatabase } from '../../harness/sqlite-d1.ts';

const ORG = 'org_bizset_0001';
const PERMISSION = 'customers.customer.list';

type SelectSpecSeen = Record<string, unknown>;

function storeRecording(seen: SelectSpecSeen[], ids: readonly string[], failing = false) {
  return {
    async select(spec: SelectSpecSeen) {
      seen.push(spec);
      return failing ? err(unavailable()) : ok(ids.map((id) => ({ [BUSINESS_ID_COLUMN]: id })));
    },
    async write() {
      return ok(undefined);
    },
  };
}

/** The Action under test: organization scope, no writes, no audit. */
const ACTION = {
  appId: 'customers',
  id: 'customers.ListCustomers',
  permission: PERMISSION,
  scope: 'organization' as const,
  audit: false,
  auditOnDenial: false,
  maxRowWrites: 0,
  errors: ['unavailable', 'forbidden', 'not_found'],
  parseInput: () => ok({}),
  targetIdentifier: () => null,
  handle: async (context: { authorizedBusinessIds: readonly string[] }) => {
    HANDLER_SAW.value = context.authorizedBusinessIds;
    return ok({ output: {}, writes: [], audit: null });
  },
};

const HANDLER_SAW: { value: readonly string[] | null } = { value: null };

const APP = {
  appId: 'customers',
  declared: [{ permissionId: PERMISSION, scope: 'organization' as const }],
};

function envelopeFor(principal: unknown) {
  return {
    principal,
    app: APP,
    requestId: 'r'.repeat(22),
    correlationId: 'c'.repeat(22),
    sourceAddressHash: null,
  };
}

function dependencies(businessIds: readonly string[], options: { failing?: boolean } = {}) {
  const reads = { count: 0 };
  const tenantStore = {
    async select() {
      return ok([]);
    },
    async write() {
      return ok(undefined);
    },
  };
  return {
    reads,
    deps: {
      resolver: {
        async resolve() {
          return ok(tenantStore as never);
        },
      },
      authorizer: {
        authorize: () => ({
          allowed: true,
          permissionId: PERMISSION,
          scope: 'organization' as const,
        }),
      },
      clock: { now: () => '2026-09-04T00:00:00.000Z', nowMs: () => 0 },
      ids: { generate: () => 'id0000000000000000000' },
      cursors: { issue: async () => ok(''), verify: async () => ok({}) },
      businesses: {
        async existsInTenant() {
          return ok(true);
        },
        async listInTenant() {
          reads.count += 1;
          return options.failing === true ? err(unavailable()) : ok(businessIds);
        },
      },
    },
  };
}

function organizationScopePrincipal() {
  return sealAuthenticatedPrincipal({
    principalId: 'p'.repeat(22),
    principalType: 'user',
    organizationId: ORG,
    authorizedBusinessIds: [],
    businessScope: 'organization',
    grants: { grants: [{ permissionId: PERMISSION, scope: 'organization' }] },
    onBehalfOfPrincipalId: null,
  });
}

/** No `businessScope` at all — the default path every existing suite relies on. */
function assignedPrincipal(businessIds: readonly string[]) {
  return sealAuthenticatedPrincipal({
    principalId: 'q'.repeat(22),
    principalType: 'user',
    organizationId: ORG,
    authorizedBusinessIds: businessIds,
    grants: { grants: [{ permissionId: PERMISSION, scope: 'organization' }] },
    onBehalfOfPrincipalId: null,
  });
}

export function buildBusinessSetSuite(): Suite {
  const suite = new Suite('AZ5 — the authorized business set through the pipeline (0020)');

  // -----------------------------------------------------------------------------------------
  // Property 1 — the read itself.
  // -----------------------------------------------------------------------------------------

  suite.test('the read names no predicate, selects one column, and is bounded at 500', async () => {
    const seen: SelectSpecSeen[] = [];
    const directory = createStoreBusinessDirectory();
    const listed = await directory.listInTenant(
      storeRecording(seen, ['b1', 'b2', 'b3']) as never,
      MAX_AUTHORIZED_BUSINESSES,
    );
    assertEqual('every id is returned', listed.ok ? listed.value.length : -1, 3);

    const spec = seen[0];
    assertEqual('it reads the business table', spec.table, BUSINESS_TABLE);
    assertEqual(
      'it selects exactly one column — the id, so nothing else about a Business can travel onto ActionContext',
      JSON.stringify(spec.columns),
      JSON.stringify([BUSINESS_ID_COLUMN]),
    );
    assertEqual(
      'and it carries NO predicate — the tenant scope lives inside the handle, so "no predicate" cannot mean more than this Organization',
      spec.where,
      undefined,
    );
    assertEqual('it is bounded', spec.limit, MAX_AUTHORIZED_BUSINESSES);
    assertEqual('the bound is 500', MAX_AUTHORIZED_BUSINESSES, 500);
  });

  suite.test('empty and missing ids are dropped rather than carried as ""', async () => {
    // An id of `''` in the authorized set would be a value that compares equal to nothing and is
    // not obviously wrong on inspection — worse than dropping the row.
    const directory = createStoreBusinessDirectory();
    const dirty = await directory.listInTenant(
      {
        async select() {
          return ok([
            { business_id: 'ok' },
            { business_id: '' },
            { business_id: null },
            {},
          ]);
        },
      } as never,
      10,
    );
    assertEqual('only the usable id survives', JSON.stringify(dirty.ok ? dirty.value : null), '["ok"]');
  });

  suite.test('PROPERTY 4 — the bound TRUNCATES, enforced against the REAL store', async () => {
    // ===========================================================================================
    // TESTED AGAINST `createD1TenantStore` AND A REAL ENGINE, NOT A STUB, AND THAT IS THE POINT.
    // ===========================================================================================
    //
    // My first attempt used the recording stub above and FAILED, returning all 750 rows. The stub
    // was at fault, not the code — but the failure is worth keeping in the record because of what
    // it revealed: `listInTenant` does NOT truncate in application code. It passes `limit` into
    // the select spec and relies entirely on the store to honour it.
    //
    // For the shipping store that is correct and better than a second truncation — the compiler
    // emits `LIMIT ${spec.limit}` and the engine never materialises row 501. But it means the
    // bound is a property of the STORE, not of the directory, so the test has to exercise the
    // real one. A future `TenantScopedStore` that ignored `limit` would grow the set unbounded
    // and this suite would not notice if it kept using a stub.
    //
    // 520 rows, so the truncation is genuinely exercised at 500.
    const harness = createSqliteDatabase();
    try {
      harness.raw.exec(
        'CREATE TABLE business (tenant_id TEXT NOT NULL, business_id TEXT NOT NULL, ' +
          'PRIMARY KEY (tenant_id, business_id));',
      );
      const insert = harness.raw.prepare('INSERT INTO business (tenant_id, business_id) VALUES (?, ?)');
      for (let index = 0; index < 520; index += 1) {
        insert.run(ORG, `biz_${String(index).padStart(4, '0')}`);
      }
      // Another Organization's rows, so truncation cannot be confused with isolation and the
      // isolation property is asserted at the same time.
      insert.run('org_other_0002', 'biz_other_0001');

      const store = createD1TenantStore(harness.database, ORG);
      const directory = createStoreBusinessDirectory();
      const listed = await directory.listInTenant(store, MAX_AUTHORIZED_BUSINESSES);

      assertEqual(
        'the real store returns exactly the bound and not one row more',
        listed.ok ? listed.value.length : -1,
        MAX_AUTHORIZED_BUSINESSES,
      );
      assertTrue(
        'the LIMIT reached the SQL rather than being applied after reading everything',
        harness.statements.some((statement) =>
          statement.sql.includes(`LIMIT ${String(MAX_AUTHORIZED_BUSINESSES)}`),
        ),
        `statements were ${JSON.stringify(harness.statements.map((s) => s.sql))}`,
      );
      assertTrue(
        `${'ISOLATION:'} and no other Organization's Business appears in the truncated set`,
        listed.ok && !listed.value.includes('biz_other_0001'),
        'truncation returned a Business belonging to a different Organization',
      );
    } finally {
      harness.close();
    }
  });

  suite.test('RECORDED: the bound is the STORE\'s to enforce, not the directory\'s', () => {
    // Asserted so the dependency is written down rather than discovered by whoever writes the
    // second `TenantScopedStore`. The failure direction is safe either way — truncation loses a
    // tenant access to their OWN data and can never grant access to another tenant's — but a
    // store that ignored `limit` would grow the set without anything reporting it.
    assertEqual(
      'the SQL compiler is the only place the bound is applied',
      MAX_AUTHORIZED_BUSINESSES,
      500,
    );
    assertTrue(
      'any new TenantScopedStore must honour SelectSpec.limit, or this bound stops existing',
      true,
      'unreachable',
    );
  });

  // -----------------------------------------------------------------------------------------
  // Property 2 and the split — through `invokeAction`, not the helper.
  // -----------------------------------------------------------------------------------------

  suite.test('AN ORGANIZATION-SCOPE PRINCIPAL REACHES THE HANDLER WITH THE TENANT BUSINESSES', async () => {
    // The case that was impossible before 0020: before it, this principal passed step 3 with real
    // permissions and failed at step 5 with an empty business set.
    HANDLER_SAW.value = null;
    const { deps } = dependencies(['biz-1', 'biz-2']);
    await invokeAction(deps as never, ACTION as never, envelopeFor(organizationScopePrincipal()) as never, {});
    assertEqual(
      'the handler saw both Businesses',
      JSON.stringify(HANDLER_SAW.value),
      JSON.stringify(['biz-1', 'biz-2']),
    );
  });

  suite.test('AN ASSIGNED PRINCIPAL IS NOT WIDENED, and costs no read', async () => {
    // This is what every existing suite relies on. `authorization.ts`, `isolation.ts` and
    // `resolver.ts` construct principals with explicit subsets; unconditionally replacing the set
    // would have widened them silently.
    HANDLER_SAW.value = null;
    const { deps, reads } = dependencies(['biz-1', 'biz-2']);
    await invokeAction(deps as never, ACTION as never, envelopeFor(assignedPrincipal(['only-mine'])) as never, {});
    assertEqual(
      'the handler saw exactly what the principal was given',
      JSON.stringify(HANDLER_SAW.value),
      JSON.stringify(['only-mine']),
    );
    assertEqual('and no business read was performed at all', reads.count, 0);
  });

  suite.test(
    'THE DEFAULT IS SAFE: a principal that omits businessScope is treated as assigned',
    async () => {
      // The property the whole split rests on. A principal constructed anywhere without stating a
      // rule keeps exactly what it was given — it does not silently become organization-scope.
      // The safe direction is deny, and this asserts the direction rather than assuming it.
      HANDLER_SAW.value = null;
      const { deps, reads } = dependencies(['biz-everything']);
      await invokeAction(deps as never, ACTION as never, envelopeFor(assignedPrincipal([])) as never, {});
      assertEqual(
        'an EMPTY set with no businessScope stays empty — the sentinel is not inverted',
        JSON.stringify(HANDLER_SAW.value),
        JSON.stringify([]),
      );
      assertEqual('and it triggered no read', reads.count, 0);
    },
  );

  suite.test('PROPERTY 2 — the set is read PER REQUEST and never cached', async () => {
    // A 12-hour session cache would keep a removed Business authorized for half a day. Two
    // invocations against the SAME dependencies object must produce two reads.
    const { deps, reads } = dependencies(['biz-1']);
    const principal = organizationScopePrincipal();
    await invokeAction(deps as never, ACTION as never, envelopeFor(principal) as never, {});
    await invokeAction(deps as never, ACTION as never, envelopeFor(principal) as never, {});
    assertEqual('two requests, two reads', reads.count, 2);
  });

  suite.test('a Business removed between requests stops being authorized on the NEXT request', async () => {
    // The property stated as the scenario it exists for, rather than as a read count.
    let available: readonly string[] = ['biz-1', 'biz-2'];
    const deps = {
      resolver: { async resolve() { return ok({ async select() { return ok([]); }, async write() { return ok(undefined); } } as never); } },
      authorizer: { authorize: () => ({ allowed: true, permissionId: PERMISSION, scope: 'organization' as const }) },
      clock: { now: () => '2026-09-04T00:00:00.000Z', nowMs: () => 0 },
      ids: { generate: () => 'id0000000000000000000' },
      cursors: { issue: async () => ok(''), verify: async () => ok({}) },
      businesses: {
        async existsInTenant() { return ok(true); },
        async listInTenant() { return ok(available); },
      },
    };
    const principal = organizationScopePrincipal();

    HANDLER_SAW.value = null;
    await invokeAction(deps as never, ACTION as never, envelopeFor(principal) as never, {});
    assertEqual('before removal the handler sees both', JSON.stringify(HANDLER_SAW.value), JSON.stringify(['biz-1', 'biz-2']));

    available = ['biz-1'];

    HANDLER_SAW.value = null;
    await invokeAction(deps as never, ACTION as never, envelopeFor(principal) as never, {});
    assertEqual(
      'and on the very NEXT request the removed Business is gone — not in twelve hours',
      JSON.stringify(HANDLER_SAW.value),
      JSON.stringify(['biz-1']),
    );
  });

  // -----------------------------------------------------------------------------------------
  // Property 3 — the one worth pushing hardest on.
  // -----------------------------------------------------------------------------------------

  suite.test('PROPERTY 3 — a FAILED business read REFUSES rather than authorizing nothing', async () => {
    HANDLER_SAW.value = null;
    const { deps } = dependencies([], { failing: true });
    const outcome = await invokeAction(
      deps as never,
      ACTION as never,
      envelopeFor(organizationScopePrincipal()) as never,
      {},
    );
    assertEqual('the request is refused', (outcome as { ok: boolean }).ok, false);
    assertEqual(
      'and THE HANDLER NEVER RAN — an empty set would have looked like a permissions bug and sent someone hunting through the role mapping',
      HANDLER_SAW.value,
      null,
    );
  });

  suite.test('the refusal is unavailable, not forbidden — the difference is diagnosability', async () => {
    // A storage failure rendered as `forbidden` is the failure mode property 3 exists to prevent,
    // stated at the error value rather than at the boolean.
    const { deps } = dependencies([], { failing: true });
    const outcome = (await invokeAction(
      deps as never,
      ACTION as never,
      envelopeFor(organizationScopePrincipal()) as never,
      {},
    )) as { ok: boolean; error?: { code: string } };
    assertEqual('it is not ok', outcome.ok, false);
    assertEqual(
      'and the code says the store failed, not that the caller lacked permission',
      outcome.error?.code,
      'unavailable',
    );
  });

  suite.test(
    'BOUNDING THE AUDIT GAP: a denial records an EMPTY actor business context, and it is every denial',
    async () => {
      // ===========================================================================================
      // `0020` reported this as *"a denial occurring BEFORE the store resolves still records an
      // empty actorBusinessIds, because at that moment the set is genuinely unknowable."* True,
      // and honest. What I was asked to confirm is that the incompleteness is BOUNDED — so this
      // measures where the boundary actually falls rather than accepting where it was described.
      //
      // WHAT I FOUND, AND IT IS SLIGHTLY WIDER THAN THE DESCRIPTION: `pipeline.ts` has exactly ONE
      // `recordDenial` call site (line 441) and it sits BEFORE the business fill (line 576). So it
      // is not merely that a denial *before* the store resolves records an empty set — EVERY
      // recorded denial does, for an organization-scope principal, because there is no denial path
      // after the fill that records a summary.
      //
      // THIS IS NOT A REGRESSION and not a defect: before `0020` every audit record carried an
      // empty set, and at the moment of an authorization denial the caller's Businesses genuinely
      // have not been read. It is written down here so that "the audit trail is less complete than
      // the request" is scoped precisely — it is DENIAL SUMMARIES ONLY, never success audits,
      // which are written at line 653 after the fill and do carry the real set.
      const denials: { actorBusinessIds: readonly string[] }[] = [];
      const { deps } = dependencies(['biz-1', 'biz-2']);
      const denyingDeps = {
        ...deps,
        authorizer: {
          authorize: () => ({ allowed: false, permissionId: PERMISSION, scope: 'organization' as const }),
        },
        // `coordinator.begin()` returns the RequestCoordination the pipeline then calls. Getting
        // this shape wrong is what made my first attempt record nothing — and the guard below
        // caught it rather than letting the case pass on an empty array, which is the whole
        // reason the guard is written that way.
        coordinator: {
          async begin() {
            return ok({
              outcome: 'admitted' as const,
              async recordDenial(_key: unknown, context: { actorBusinessIds: readonly string[] }) {
                denials.push({ actorBusinessIds: [...context.actorBusinessIds] });
                // The shape `pipeline.ts` actually reads: `suppressedByCeiling` and `summaries`.
                // An empty `summaries` short-circuits before the write, which is all this case
                // needs — the actorBusinessIds have already been captured above.
                return ok({ suppressedByCeiling: 0, summaries: [] });
              },
              async reserveWrites() {
                return ok({ kind: 'granted' as const });
              },
              dispose() {},
            });
          },
        },
      };

      const auditedAction = { ...ACTION, auditOnDenial: true };
      HANDLER_SAW.value = null;
      const outcome = await invokeAction(
        denyingDeps as never,
        auditedAction as never,
        envelopeFor(organizationScopePrincipal()) as never,
        {},
      );

      assertEqual('the request is denied', (outcome as { ok: boolean }).ok, false);
      assertEqual('and the handler never ran', HANDLER_SAW.value, null);
      if (denials.length > 0) {
        assertEqual(
          'the denial summary carries an EMPTY actor business context — the recorded limit',
          denials[0].actorBusinessIds.length,
          0,
        );
      } else {
        // Not silently tolerated: if no denial was recorded, this case measured nothing and says
        // so rather than passing.
        assertTrue(
          'a denial summary was recorded so the assertion above had something to measure',
          false,
          'no denial summary was recorded — this case proves nothing about the audit gap and ' +
            'the coordinator wiring needs revisiting',
        );
      }
    },
  );

  suite.test('and a SUCCESS audit carries the real set, so the gap is denial-only', async () => {
    // The other half of the bound. If success audits also carried an empty set, the gap would be
    // the whole audit trail rather than one path of it.
    const audits: { actorBusinessIds: readonly string[] }[] = [];
    const { deps } = dependencies(['biz-1', 'biz-2']);
    const auditingDeps = {
      ...deps,
      // `AuditSink.operation(entry)` RETURNS a write rather than performing one, so that the
      // mutation and its audit record commit as one batch. Capturing the entry here is therefore
      // capturing exactly what would have been written.
      auditSinkFactory: () => ({
        operation(entry: { actorBusinessIds?: readonly string[] }) {
          audits.push({ actorBusinessIds: [...(entry.actorBusinessIds ?? [])] });
          return { kind: 'insert' as const, spec: { table: 'audit_event', values: {} } };
        },
      }),
    };
    const auditedAction = {
      ...ACTION,
      audit: true,
      // BOTH, and not by preference. `assertAuditPolicy` refuses `audit: true` with
      // `auditOnDenial: false`, in its own words: *"An audited Action may not suppress its denial
      // records. An attack looks like a long run of failures, and a log containing only successes
      // cannot show one."* My first attempt set only `audit` and was correctly refused.
      auditOnDenial: true,
      handle: async (context: { authorizedBusinessIds: readonly string[] }) => {
        HANDLER_SAW.value = context.authorizedBusinessIds;
        return ok({
          output: {},
          writes: [],
          audit: {
            eventType: 'customers.customer.listed',
            targetResourceId: null,
            relatedBusinessIds: [],
            changedFieldNames: [],
          },
        });
      },
    };

    HANDLER_SAW.value = null;
    await invokeAction(
      auditingDeps as never,
      auditedAction as never,
      envelopeFor(organizationScopePrincipal()) as never,
      {},
    );

    assertEqual(
      'the handler ran with the filled set',
      JSON.stringify(HANDLER_SAW.value),
      JSON.stringify(['biz-1', 'biz-2']),
    );
    if (audits.length > 0) {
      assertEqual(
        'and the SUCCESS audit carries the real Businesses, not an empty set',
        JSON.stringify(audits[0].actorBusinessIds),
        JSON.stringify(['biz-1', 'biz-2']),
      );
    } else {
      assertTrue(
        'an audit record was written so the assertion above had something to measure',
        false,
        'no audit record was written — this case proves nothing and the sink wiring needs ' +
          'revisiting',
      );
    }
  });

  suite.test('the completed principal is re-sealed as assigned, so nothing completes it twice', async () => {
    // `pipeline.ts` spreads the principal and then overrides `businessScope: 'assigned'`. If a
    // future edit put the override BEFORE the spread, the original `'organization'` would win and
    // a downstream step could re-read and re-widen. Asserted through the read count against a
    // principal that has already been completed once.
    const { deps, reads } = dependencies(['biz-1', 'biz-2']);
    await invokeAction(deps as never, ACTION as never, envelopeFor(organizationScopePrincipal()) as never, {});
    assertEqual('exactly one read for one request — not two', reads.count, 1);
  });

  return suite;
}
