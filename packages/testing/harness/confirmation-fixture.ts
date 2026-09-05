/**
 * ===========================================================================================
 * THE CONFIRMATION WORLD, AND THE SYNTHETIC CRITICAL ACTION.
 * `docs/decisions/0027` · `docs/decisions/0007` D15 · contract `confirmation-v1`.
 * ===========================================================================================
 *
 * *** WHY A SYNTHETIC ACTION IS THE POINT AND NOT A CONVENIENCE. ***
 *
 * `confirmation-v1` claims that *"declaring a permission critical automatically requires
 * confirmation, with no code change."* **NO `critical` ACTION EXISTS IN THIS REPOSITORY.**
 * `customers.DeleteCustomer` is deferred and unbuilt, so the gate ships guarding nothing — which is
 * `M-1`'s shape exactly: code that is correct, unexercised, and found broken by whoever first
 * needs it.
 *
 * A claim about what happens automatically is only true if something exercises the automatic part.
 * This Action is that something. It needs nothing from Core: it declares
 * `customers.customer.delete`, which `critical-permissions.ts` already lists, and the pipeline
 * derives the requirement from the permission with no per-Action opt-in to set.
 *
 * ===========================================================================================
 * WHAT IS REAL HERE
 * ===========================================================================================
 *
 * Every piece of the mechanism is the shipped one: `createConfirmationBinder`,
 * `createConfirmationService`, `createD1ConfirmationStore` over a control plane built from the
 * real migrations including `0011`, `createCredentialVerifier` over `createD1CredentialStore`,
 * `createConfirmationGate`, and `invokeAction` itself. The credential is enrolled through the real
 * `buildSeedRows`.
 *
 * THE TENANT SIDE COMES FROM `createWorld()` UNCHANGED, and this fixture adds `confirmations` to
 * the dependencies it produces rather than editing `world.ts` — 166 Customer Directory cases run
 * against that file and none of them should move because a confirmation suite was written.
 *
 * ALL DATA IS SYNTHETIC. Invented identifiers, an invented password, two fixed 32-byte test
 * constants that are not credentials and are never printed.
 */

import { createWorld } from './world.ts';
import type { World } from './world.ts';
import { ORG_A, BIZ_A_NORTH, makePrincipal } from './world.ts';
import { createPlatformControlPlane } from './platform-fixture.ts';
import { seedCredential, seedPrincipal } from './control-plane-fixture.ts';
import type { SqliteHarness } from './sqlite-d1.ts';

import type { Result } from '../../../platform/core/kernel/result.ts';
import { err, ok } from '../../../platform/core/kernel/result.ts';
import { invalidArgument, detail, unavailable } from '../../../platform/core/kernel/errors.ts';
import type { ActionDefinition } from '../../../platform/core/action/action.ts';
import { asAnyAction } from '../../../platform/core/action/action.ts';
import { invokeAction } from '../../../platform/core/action/pipeline.ts';
import { AUDIT_EVENT_ROW_WRITES } from '../../../platform/core/storage/write-cost.ts';
import type { AuthenticatedPrincipal } from '../../../platform/core/tenancy/tenant-context.ts';

import { createConfirmationBinder } from '../../../platform/core/confirmation/binding.ts';
import { createConfirmationService } from '../../../platform/core/confirmation/confirmation-service.ts';
import type {
  ConfirmationChallenge,
  ConfirmationService,
} from '../../../platform/core/confirmation/confirmation-service.ts';
import {
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
  createConfirmationGate,
} from '../../../platform/core/confirmation/confirmation-gate.ts';
import type { ConfirmationGate } from '../../../platform/core/confirmation/confirmation-gate.ts';
import { createD1ConfirmationStore } from '../../../platform/core/confirmation/adapters/d1/d1-confirmation-store.ts';

import { createD1CredentialStore } from '../../../platform/core/identity/adapters/d1/d1-credential-store.ts';
import { createCredentialVerifier } from '../../../platform/core/identity/credential-verifier.ts';
import {
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
} from '../../../platform/core/identity/credential-verifier.ts';
import {
  createHmacIdentifierHasher,
  normalizeIdentifier,
} from '../../../platform/core/identity/credential-store.ts';
import { buildSeedRows } from '../../../platform/core/identity/tools/seed-principal.ts';
import { deriveLoginCredential as webDerive } from '../../../platform/web/src/api/kdf.ts';
import { createInProcessControlPlaneWriteAdmission } from '../../../platform/core/identity/control-plane-admission.ts';
import { createInProcessDayWriteBudget } from '../../../platform/core/protection/in-process-coordinator.ts';
import { DAILY_ALLOCATION } from '../../../platform/core/protection/write-admission.ts';

// ---------------------------------------------------------------------------
// Synthetic identities. Two principals, because the attack that matters is a cross-principal one.
// ---------------------------------------------------------------------------

export const CALLER_PRINCIPAL = 'prn_confirm_caller01';
export const OTHER_PRINCIPAL = 'prn_confirm_other001';

export const CALLER_EMAIL = 'Caller.One@Example.Invalid';
export const OTHER_EMAIL = 'Other.Two@Example.Invalid';
export const CALLER_PASSWORD = 'confirmation-fixture-caller-0001';
export const OTHER_PASSWORD = 'confirmation-fixture-other-0002';

export const SESSION_ID = 'ses_confirm_00000001';
export const OTHER_SESSION_ID = 'ses_confirm_00000002';

/** The customer the synthetic Action names. Seeded by `createWorld` in Organization A. */
export const TARGET_CUSTOMER = 'cust_alpha_anna1';
export const OTHER_CUSTOMER = 'cust_alpha_brun1';

const LOOKUP_KEY = new TextEncoder().encode('dudo-test-lookup-key-32-bytes!!!');
const BINDING_KEY = new Uint8Array(32).fill(0x3c);
const ENROLLED_AT = Date.UTC(2026, 8, 5);
const SALT = new Uint8Array([2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]);

// ---------------------------------------------------------------------------
// The synthetic critical Action
// ---------------------------------------------------------------------------

type CriticalInput = { readonly customer_id: string };

/**
 * A `critical` Action that reads nothing, writes nothing, and exists to be gated.
 *
 * ITS `id` IS `customers.DeleteCustomer` — THE REAL DEFERRED ACTION'S ID — AND THAT CHANGED.
 *
 * It was `customers.customer.delete`, because `statements.ts`'s catalog was keyed by that string.
 * I reported that as an observation: the catalog was keyed by a PERMISSION identifier, so the real
 * `customers.DeleteCustomer` would have found no statement and been unconfirmable the day it was
 * built. `core-agent` re-keyed the catalog to Action ids, which is the right fix — and this fixture
 * follows it, so the synthetic Action now stands in for the real one under its real name.
 *
 * `parseInput` ACCEPTS THE THREE CONFIRMATION FIELDS AND IGNORES THEM, and every real critical
 * Action will have to. The pipeline validates at step 4 and gates at step 6, so a `parseInput` that
 * refused unknown fields — which is what `validateObject` does for every Action in the Customer
 * Directory — would reject a correctly confirmed request BEFORE the gate ever saw it. That is a
 * client-visible obligation the contract does not state, and it is recorded here rather than
 * discovered by whoever builds the first real one.
 */
/**
 * THE PORT'S OWN CONSTANTS, IMPORTED RATHER THAN TRANSCRIBED — since 2026-09-05.
 *
 * These were three string literals. `REAUTH_IDENTIFIER_FIELD` changed from `identifier` to
 * `reauth_identifier` at 16:58 and **eighteen cases went red at once**, every one of them a
 * fixture asserting a field name the port no longer used. Transcribing a wire field name into a
 * harness is the same class of drift as transcribing a permission catalog: correct until it is
 * not, and silent in between.
 */
export const CONFIRMATION_FIELD_NAMES: readonly string[] = Object.freeze([
  CONFIRMATION_ID_FIELD,
  REAUTH_DERIVED_VALUE_FIELD,
  REAUTH_IDENTIFIER_FIELD,
]);

export function createSyntheticCriticalAction(
  observe: { calls: number; failNext: boolean } = { calls: 0, failNext: false },
): ActionDefinition<CriticalInput, { readonly performed: true }> {
  return {
    id: 'customers.DeleteCustomer',
    appId: 'customers',
    title: 'Synthetic critical operation',
    description:
      'A test-only Action declaring a critical permission. It performs nothing: what is under ' +
      'test is whether the pipeline gates it, not what it would do.',
    errors: [
      'invalid_argument',
      'unauthenticated',
      'forbidden',
      'not_found',
      'rate_limited',
      'quota_exceeded',
      'internal',
      'unavailable',
      'timeout',
    ],
    permission: 'customers.customer.delete',
    scope: 'organization',
    sensitivity: 'critical',
    idempotent: false,
    audit: true,
    exposure: ['internal'],
    /**
     * `AUDIT_EVENT_ROW_WRITES`, and it is declared rather than guessed at 0.
     *
     * The handler performs no write of its own, but `audit: true` means the pipeline writes an
     * audit event — five row-writes — and the reservation is sized from THIS number. Declaring 0
     * produces an undersized reservation and the storage boundary refuses it, which surfaces as
     * `internal` on the SUCCESS path. That is what this Action did on its first run, and it is
     * worth recording: a critical Action that audits cannot declare a zero write cost, and nothing
     * in the type system says so.
     */
    maxRowWrites: AUDIT_EVENT_ROW_WRITES,
    parseInput(raw: unknown): Result<CriticalInput> {
      if (raw === null || typeof raw !== 'object') {
        return err(invalidArgument([detail('', 'must_be_an_object')]));
      }
      const value = (raw as Record<string, unknown>).customer_id;
      if (typeof value !== 'string' || value.length === 0) {
        return err(invalidArgument([detail('customer_id', 'required')]));
      }
      return ok({ customer_id: value });
    },
    targetIdentifier(raw: unknown): string | null {
      const value = (raw as Record<string, unknown> | null)?.customer_id;
      return typeof value === 'string' ? value : null;
    },
    async handle() {
      // THE OBSERVER IS THE WHOLE POINT OF THE HANDLER. Every case asserts on whether the
      // OPERATION RAN, not only on the response — a gate that refused after performing the
      // operation would return `forbidden` and still have deleted the customer.
      observe.calls += 1;
      if (observe.failNext) {
        // `confirmation-v1` §lifecycle: a confirmation is spent whether or not the operation then
        // succeeds. Failing HERE — after the gate, inside the operation — is the only honest way
        // to reach that path: the confirmation is already spent by the time this returns.
        observe.failNext = false;
        return err(unavailable());
      }
      return ok({
        output: { performed: true as const },
        writes: [],
        audit: { targetResourceId: null, relatedBusinessIds: [], changedFieldNames: [] },
      });
    },
  };
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type ConfirmationWorld = {
  readonly world: World;
  readonly control: SqliteHarness;
  readonly service: ConfirmationService;
  readonly gate: ConfirmationGate;
  readonly caller: AuthenticatedPrincipal;
  /** Counts handler invocations. `calls` must stay 0 on every refusal. */
  /**
   * Counts handler invocations. `calls` must stay 0 on every refusal.
   *
   * `failNext` makes the NEXT invocation fail INSIDE the operation, after the gate has already
   * spent the confirmation — the only honest way to reach *"spent even when the operation fails"*.
   */
  readonly performed: { calls: number; failNext: boolean };
  /** The derived value the caller's own client would submit. */
  callerDerivedValue(): Promise<string>;
  otherDerivedValue(): Promise<string>;
  /** Issues a real challenge through the shipped service. */
  challenge(options?: {
    readonly actionId?: string;
    readonly permissionId?: string;
    readonly sessionId?: string;
    readonly principalId?: string;
    readonly parameters?: Readonly<Record<string, string | boolean | null>>;
  }): Promise<Result<ConfirmationChallenge>>;
  /** Drives the SHIPPED pipeline against the synthetic critical Action. */
  invoke(
    body: Readonly<Record<string, unknown>>,
    options?: { readonly sessionId?: string | null; readonly gateComposed?: boolean },
  ): Promise<Result<unknown>>;
  confirmationRows(): Record<string, unknown>[];
  close(): void;
};

export type ConfirmationWorldOptions = {
  /**
   * Wraps the REAL gate. This is how `0027`'s central negative control is applied: no file under
   * `platform/core/**` is edited, and the wrapper sits exactly where the gate is consumed.
   */
  readonly wrapGate?: (gate: ConfirmationGate) => ConfirmationGate;
  /** `false` composes NO gate at all — the uncomposed-runtime case. */
  readonly composeGate?: boolean;
};

export async function createConfirmationWorld(
  options: ConfirmationWorldOptions = {},
): Promise<ConfirmationWorld> {
  const world = await createWorld();
  const control = createPlatformControlPlane();

  // ---- Two enrolled principals. The second exists so the cross-principal attack is reachable.
  const identifiers = await createHmacIdentifierHasher(LOOKUP_KEY);
  for (const [principalId, email, password] of [
    [CALLER_PRINCIPAL, CALLER_EMAIL, CALLER_PASSWORD],
    [OTHER_PRINCIPAL, OTHER_EMAIL, OTHER_PASSWORD],
  ] as const) {
    const rows = await buildSeedRows({
      email,
      password,
      lookupKey: LOOKUP_KEY,
      nowMs: ENROLLED_AT,
      salt: SALT,
      principalId,
    });
    seedPrincipal(control, principalId);
    seedCredential(control, {
      identifierHash: rows.identifierHash,
      principalId,
      algorithm: SUPPORTED_ALGORITHM,
      iterations: SERVER_KDF_ITERATIONS,
      salt: rows.salt,
      verifier: rows.verifier,
    });
  }

  const budget = createInProcessDayWriteBudget({ ...DAILY_ALLOCATION });
  const admission = createInProcessControlPlaneWriteAdmission(budget);
  const binder = await createConfirmationBinder(BINDING_KEY);
  const service = createConfirmationService({
    store: createD1ConfirmationStore(control.database),
    binder,
    admission,
    ids: world.ids,
    clock: world.clock,
  });
  const verifier = await createCredentialVerifier({
    credentials: createD1CredentialStore(control.database),
    identifiers,
  });
  const realGate = createConfirmationGate({ service, verifier });
  const gate = options.wrapGate === undefined ? realGate : options.wrapGate(realGate);

  const performed = { calls: 0, failNext: false };
  const action = createSyntheticCriticalAction(performed);

  // The caller holds the grant. `customers.customer.delete` is granted to NO role, so a principal
  // that could reach this Action cannot be produced from a membership — which is `0019` working,
  // and is why the grant is stated explicitly here rather than derived.
  const caller = makePrincipal({
    principalId: CALLER_PRINCIPAL,
    organizationId: ORG_A,
    authorizedBusinessIds: [BIZ_A_NORTH],
    grants: [{ permissionId: 'customers.customer.delete', scope: 'organization' }],
  });

  /**
   * The value a real client submits, derived by the SHIPPED WEB CLIENT.
   *
   * NOT by `buildSeedRows`, which deliberately returns no client value — *"THE RETURN VALUE
   * CONTAINS NO PASSWORD AND NO CLIENT-DERIVED VALUE"* — and not by a reimplementation here. The
   * re-authentication half is a claim about what a client sends, so the client is what sends it.
   */
  async function derivedValueFor(email: string, password: string): Promise<string> {
    return (await webDerive(email, password)).derived_key;
  }

  return {
    world,
    control,
    service,
    gate,
    caller,
    performed,

    callerDerivedValue: () => derivedValueFor(CALLER_EMAIL, CALLER_PASSWORD),
    otherDerivedValue: () => derivedValueFor(OTHER_EMAIL, OTHER_PASSWORD),

    challenge(challengeOptions = {}) {
      return service.issueChallenge({
        principalId: challengeOptions.principalId ?? CALLER_PRINCIPAL,
        sessionId: challengeOptions.sessionId ?? SESSION_ID,
        actionId: challengeOptions.actionId ?? action.id,
        permissionId: challengeOptions.permissionId ?? action.permission,
        parameters: challengeOptions.parameters ?? { customer_id: TARGET_CUSTOMER },
        locale: 'en',
      });
    },

    invoke(body, invokeOptions = {}) {
      const composed = invokeOptions.gateComposed ?? options.composeGate ?? true;
      return invokeAction(
        {
          ...world.dependencies,
          ...(composed ? { confirmations: gate } : {}),
        },
        // `asAnyAction` is Core's own widening, the same one `world.ts` and every App router use.
        // A cast here would be the harness deciding a type question the codebase already answers.
        asAnyAction(action),
        {
          principal: caller,
          app: world.app,
          requestId: world.ids.generate(),
          correlationId: world.ids.generate(),
          sourceAddressHash: null,
          sessionId: invokeOptions.sessionId === undefined ? SESSION_ID : invokeOptions.sessionId,
        },
        body,
      );
    },

    confirmationRows(): Record<string, unknown>[] {
      return control.raw
        .prepare('SELECT * FROM confirmation ORDER BY rowid')
        .all() as Record<string, unknown>[];
    },

    close(): void {
      control.close();
      world.close();
    },
  };
}

/** The identifier normalisation both clients apply, exposed so cases can assert on the salt. */
export { normalizeIdentifier };
