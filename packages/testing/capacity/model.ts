/**
 * ===========================================================================================
 * THE CAPACITY MODEL. Parameters in, binding limit out.
 * ===========================================================================================
 *
 * `0030`: *"A measured capacity model is owed. The estimate that the free tier supports 100–150
 * small businesses is arithmetic over per-operation costs, not a measurement."*
 *
 * **EVERY ASSUMPTION IS A NAMED INPUT AND NONE IS BURIED.** The point is not to produce a number;
 * it is to produce a function, so that when the user says *"our customers are busier than that"*
 * the answer moves without anyone re-deriving it.
 *
 * ===========================================================================================
 * WHAT IS MEASURED AND WHAT IS ASSUMED — THE LINE MATTERS MORE THAN EITHER SIDE
 * ===========================================================================================
 *
 * **MEASURED** (by `workload.ts` and `storage.ts`, against the shipped code and the real schema):
 * the per-operation row-write cost, the per-operation ledger-call count, and the bytes a row of
 * each growing table occupies.
 *
 * **ASSUMED** (the parameters below): how many businesses, how many users each has, how many
 * operations each user performs, and how long history is kept. **No measurement can supply these
 * — they are facts about customers Dudo does not have yet.**
 *
 * A model that hid the second set inside the first would be the estimate `0030` rejected, wearing
 * a measurement's clothes.
 */

export type Assumptions = {
  /** Users who sign in, per business. */
  readonly usersPerBusiness: number;
  /** Sign-ins per user per working day. A login is a session insert; a logout deletes it. */
  readonly loginsPerUserPerDay: number;
  /**
   * Audited Actions per user per working day — creates, updates, archives.
   *
   * THE DOMINANT TERM IN BOTH LIMITS, which is why it is first among the parameters a reader
   * should argue with. Every audited Action writes an `audit_event` row, and that row is both a
   * row-write today and bytes forever.
   */
  readonly auditedActionsPerUserPerDay: number;
  /** Reads that write nothing. Included because they still consume a Worker request. */
  readonly readsPerUserPerDay: number;
  /** Working days per month. */
  readonly workingDaysPerMonth: number;
  /** How long the model projects storage growth. */
  readonly retentionMonths: number;
  /** Platform-operator requests per day, across the whole platform. Every one writes a P4 record. */
  readonly operatorRequestsPerDay: number;
};

/** A deliberately conservative starting point. Every field is meant to be argued with. */
export const BASELINE: Assumptions = {
  usersPerBusiness: 5,
  loginsPerUserPerDay: 2,
  auditedActionsPerUserPerDay: 20,
  readsPerUserPerDay: 60,
  workingDaysPerMonth: 22,
  retentionMonths: 12,
  operatorRequestsPerDay: 50,
};

/**
 * The free-tier ceilings, and the SELF-IMPOSED one that binds before them.
 *
 * `0014` §A: Dudo admits at most 80,000 estimated row-writes/day against D1's 100,000, keeping
 * 20,000 as margin that is deliberately NOT spendable. **The model uses 80,000, because that is
 * the number the system will actually refuse at** — using 100,000 would model a system Dudo does
 * not ship.
 */
export const LIMITS = {
  workerRequestsPerDay: 100_000,
  d1RowWritesPerDay: 100_000,
  dudoAdmittedRowWritesPerDay: 80_000,
  durableObjectRequestsPerDay: 100_000,
  d1BytesPerDatabase: 500 * 1024 * 1024,
  d1BytesTotal: 5 * 1024 * 1024 * 1024,
} as const;

export type PerBusinessDay = {
  readonly controlPlaneRowWrites: number;
  readonly tenantRowWrites: number;
  readonly totalRowWrites: number;
  readonly ledgerCalls: number;
  readonly workerRequests: number;
  readonly bytesPerDay: number;
};

export type MeasuredCosts = {
  /** Billed control-plane row-writes for one login (session insert). */
  readonly loginControlWrites: number;
  readonly loginLedgerCalls: number;
  readonly logoutControlWrites: number;
  readonly logoutLedgerCalls: number;
  /** One audited Action: its own writes plus its audit row, tenant side. */
  readonly auditedActionTenantWrites: number;
  readonly auditedActionLedgerCalls: number;
  /** One platform-operator request: the P4 record. */
  readonly operatorRequestControlWrites: number;
  readonly operatorRequestLedgerCalls: number;
  /** Bytes, measured. */
  readonly bytesPerAuditEvent: number;
  readonly bytesPerOperatorAction: number;
  readonly bytesPerSession: number;
};

export function perBusinessDay(a: Assumptions, m: MeasuredCosts): PerBusinessDay {
  const logins = a.usersPerBusiness * a.loginsPerUserPerDay;
  const actions = a.usersPerBusiness * a.auditedActionsPerUserPerDay;
  const reads = a.usersPerBusiness * a.readsPerUserPerDay;

  const controlPlaneRowWrites = logins * (m.loginControlWrites + m.logoutControlWrites);
  const tenantRowWrites = actions * m.auditedActionTenantWrites;
  const ledgerCalls =
    logins * (m.loginLedgerCalls + m.logoutLedgerCalls) + actions * m.auditedActionLedgerCalls;

  return {
    controlPlaneRowWrites,
    tenantRowWrites,
    totalRowWrites: controlPlaneRowWrites + tenantRowWrites,
    ledgerCalls,
    // One Worker request per operation. Logins are two (login and logout).
    workerRequests: logins * 2 + actions + reads,
    bytesPerDay: actions * m.bytesPerAuditEvent,
  };
}

export type Binding = {
  readonly limit: string;
  readonly businesses: number;
  /** How the number was arrived at, in one line, so it can be checked rather than trusted. */
  readonly derivation: string;
};

/**
 * How many businesses each limit permits, and which one binds first.
 *
 * **STORAGE IS RETURNED AS A PAIR — businesses AND months — because it is the only limit where
 * "how many" is not a complete answer.** Transactions recover overnight; history does not. A
 * storage answer stated as a business count alone is the thing `0030` warns about.
 */
export function bindingLimits(
  a: Assumptions,
  m: MeasuredCosts,
  platformOverheadRowWrites: number,
  platformOverheadLedgerCalls: number,
): Binding[] {
  const day = perBusinessDay(a, m);
  const limits: Binding[] = [];

  const rowBudget = LIMITS.dudoAdmittedRowWritesPerDay - platformOverheadRowWrites;
  limits.push({
    limit: 'D1 rows written / day (Dudo self-limit, 80,000 of 100,000)',
    businesses: Math.floor(rowBudget / day.totalRowWrites),
    derivation:
      `(80,000 admitted − ${String(platformOverheadRowWrites)} platform overhead) ÷ ` +
      `${String(day.totalRowWrites)} per business-day`,
  });

  const ledgerBudget = LIMITS.durableObjectRequestsPerDay - platformOverheadLedgerCalls;
  limits.push({
    limit: 'Durable Object requests / day (the single global day ledger)',
    businesses: Math.floor(ledgerBudget / day.ledgerCalls),
    derivation:
      `(100,000 − ${String(platformOverheadLedgerCalls)} platform overhead) ÷ ` +
      `${String(day.ledgerCalls)} ledger calls per business-day`,
  });

  limits.push({
    limit: 'Worker requests / day',
    businesses: Math.floor(LIMITS.workerRequestsPerDay / day.workerRequests),
    derivation: `100,000 ÷ ${String(day.workerRequests)} requests per business-day`,
  });

  const bytesPerBusinessPerMonth = day.bytesPerDay * a.workingDaysPerMonth;
  const bytesPerBusinessOverRetention = bytesPerBusinessPerMonth * a.retentionMonths;
  limits.push({
    limit: `D1 storage, 500 MB per database, over ${String(a.retentionMonths)} months`,
    businesses: Math.floor(LIMITS.d1BytesPerDatabase / bytesPerBusinessOverRetention),
    derivation:
      `500 MB ÷ (${String(Math.round(bytesPerBusinessPerMonth / 1024))} KiB per business-month × ` +
      `${String(a.retentionMonths)} months)`,
  });

  return limits.sort((left, right) => left.businesses - right.businesses);
}

/**
 * For a fixed number of businesses, how long until storage binds.
 *
 * THE HONEST FORM OF THE STORAGE ANSWER. `0030`: *"If storage binds first, the honest statement is
 * not '150 businesses' but '150 businesses for N months', and N is the number that matters."*
 */
export function monthsUntilStorageBinds(
  businesses: number,
  a: Assumptions,
  m: MeasuredCosts,
): number {
  const perMonth = perBusinessDay(a, m).bytesPerDay * a.workingDaysPerMonth * businesses;
  return perMonth === 0 ? Number.POSITIVE_INFINITY : LIMITS.d1BytesPerDatabase / perMonth;
}
