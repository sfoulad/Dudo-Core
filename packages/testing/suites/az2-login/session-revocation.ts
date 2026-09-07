/**
 * ===========================================================================================
 * LOGOUT UNDER AN EXHAUSTED WRITE BUDGET. `docs/decisions/0018`, `0014` §A.
 * ===========================================================================================
 *
 * THE BEHAVIOUR UNDER TEST, and it is a security behaviour that nobody had exercised:
 *
 *   `identity.session.revoke` is `disclosure: 'collapsed'` and returns `cleared` on all six of
 *   its paths. One of those paths is *"the store or the budget said no"*. Revocation costs
 *   `SESSION_ROW_WRITES` = 3, so at the daily ceiling **the delete does not happen and the caller
 *   is told the same thing as if it had.**
 *
 * The consequence, stated the way a user would experience it: they press Sign out, the interface
 * says they are signed out, the clearing cookie is issued — and **the session row is still there
 * and the credential is still live.** On a shared computer, anyone who restores the cookie, or
 * any client that kept the `Bearer` value, is signed back in without a password.
 *
 * ===========================================================================================
 * THIS IS A RECORDED CONSEQUENCE, NOT AN UNDISCOVERED BUG — AND IT IS STILL WORTH TESTING
 * ===========================================================================================
 *
 * `session-resolution.ts` already says it, in the code, in these words: *"A REFUSED LOGOUT IS
 * INVISIBLE TO THE USER. Reported; it is the price of the collapse, not a defect in it."*
 *
 * So the point of this suite is not to discover the behaviour. It is to make it EXECUTABLE, so
 * that three things stay true: that the refusal really is a refusal and not a silent success,
 * that the session really does survive it, and that the collapse really does hide it. If a
 * future change makes revocation cheaper, unmetered, or best-effort, these cases move — and
 * whichever way they move, someone has to look at them.
 *
 * The likeliest trigger is the budget, not a fault. That is why the budget is what is exhausted
 * here rather than the store being broken.
 *
 * ===========================================================================================
 * WHAT IS SUBSTITUTED, AND WHAT IS NOT
 * ===========================================================================================
 *
 * The real `createInProcessControlPlaneWriteAdmission`, the real `createSessionResolver`, the
 * real `createD1ControlPlaneStores` and the real migrations are used unchanged. ONLY the
 * `DayWriteBudget` underneath is a fixture, because draining the true 3,000-row-write ceiling
 * organically would need a thousand logins per case and would test the arithmetic rather than
 * the behaviour. Each case asserts the budget actually reached zero rather than assuming it.
 */

import { Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  countSessions,
  createControlPlaneDatabase,
  createExhaustibleDayBudget,
  seedOrganization,
  seedPrincipal,
} from '../../harness/control-plane-fixture.ts';
import { createD1ControlPlaneStores } from '../../../../platform/core/identity/adapters/d1/d1-control-plane-store.ts';
import { createSessionResolver } from '../../../../platform/core/identity/session-resolution.ts';
import type { SessionResolver } from '../../../../platform/core/identity/session-resolution.ts';
import {
  SESSION_ROW_WRITES,
  createInProcessControlPlaneWriteAdmission,
} from '../../../../platform/core/identity/control-plane-admission.ts';
import type { DayWriteBudget } from '../../../../platform/core/protection/write-admission.ts';
import { createDenyAllPrincipalAuthorizationSource } from '../../../../platform/core/identity/principal-authorization-source.ts';
import { quotaExceeded } from '../../../../platform/core/kernel/errors.ts';
import { toRfc3339Utc } from '../../../../platform/core/kernel/clock.ts';
import type { SqliteHarness } from '../../harness/sqlite-d1.ts';

const PRINCIPAL = 'prn_logout_0001';
const ORGANIZATION = 'org_logout_0001';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 8, 4, 9, 0, 0);

type Fixture = {
  readonly harness: SqliteHarness;
  readonly sessions: SessionResolver;
  remaining(): number;
  close(): void;
};

function createFixture(budgetTotal: number): Fixture {
  const harness = createControlPlaneDatabase();
  seedPrincipal(harness, PRINCIPAL);
  seedOrganization(harness, ORGANIZATION);
  const stores = createD1ControlPlaneStores(harness.database);
  const exhaustible = createExhaustibleDayBudget(budgetTotal);
  const sessions = createSessionResolver({
    store: stores.identity,
    authorization: createDenyAllPrincipalAuthorizationSource(),
    admission: createInProcessControlPlaneWriteAdmission(
      exhaustible.budget as unknown as DayWriteBudget,
    ),
    ids: createSequentialIds(),
    // ===================================================================================
    // `now` WAS MISSING, AND NOTHING AT RUNTIME COULD HAVE TOLD US.
    // ===================================================================================
    //
    // `Clock` requires both `now()` and `nowMs()`. This literal supplied only `nowMs`, so any
    // code path in `createSessionResolver` that called `clock.now()` would have thrown
    // `TypeError: clock.now is not a function` — and the paths these cases exercise happen not
    // to call it. **A fixture that satisfies a port by accident is exactly what
    // `npm run typecheck:tests` was added for**, and this is the diagnostic the previous
    // `qa-agent` flagged first because it is invisible until the day a code path moves.
    //
    // `toRfc3339Utc(NOW_MS)` rather than a transcribed timestamp string: the two must agree, and
    // a literal is one edit from not agreeing with `NOW_MS`.
    clock: { now: () => toRfc3339Utc(NOW_MS), nowMs: () => NOW_MS },
    sessionLifetimeMs: TWELVE_HOURS_MS,
  });
  return {
    harness,
    sessions,
    remaining: exhaustible.remaining,
    close: () => {
      harness.close();
    },
  };
}

function createSequentialIds(): { generate(): string } {
  let counter = 0;
  return {
    generate(): string {
      counter += 1;
      return `ses_logout_${String(counter).padStart(6, '0')}`;
    },
  };
}

export function buildSessionRevocationSuite(): Suite {
  const suite = new Suite('AZ2 — logout under an exhausted write budget (0018, 0014 §A)');

  suite.test('the control: with budget, logout deletes the session row', async () => {
    // Without this the exhausted cases below could pass because revocation never worked at all.
    const fixture = createFixture(1_000);
    try {
      const issued = expectOk(
        'a session is issued',
        await fixture.sessions.issueSession({
          verifiedPrincipalId: PRINCIPAL,
          requestedOrganizationId: null,
        }),
      ) as { sessionId: string };
      assertEqual('the row exists', countSessions(fixture.harness, issued.sessionId), 1);

      expectOk('revocation succeeds', await fixture.sessions.revokeSession(issued.sessionId));
      assertEqual(
        'and the row is gone',
        countSessions(fixture.harness, issued.sessionId),
        0,
      );
    } finally {
      fixture.close();
    }
  });

  suite.test(
    'THE FINDING: with the budget exhausted, logout is refused and THE SESSION SURVIVES',
    async () => {
      // Enough budget for exactly one session insert (3 row-writes) and nothing more, so the
      // revocation that follows is the operation that runs out.
      const fixture = createFixture(SESSION_ROW_WRITES);
      try {
        const issued = expectOk(
          'a session is issued while budget remains',
          await fixture.sessions.issueSession({
            verifiedPrincipalId: PRINCIPAL,
            requestedOrganizationId: null,
          }),
        ) as { sessionId: string };
        assertEqual('the session row exists', countSessions(fixture.harness, issued.sessionId), 1);
        assertEqual('and the budget is now empty', fixture.remaining(), 0);

        expectError(
          'revocation is refused for quota, not for any other reason',
          await fixture.sessions.revokeSession(issued.sessionId),
          quotaExceeded(),
        );

        assertEqual(
          'THE SESSION ROW IS STILL THERE after a logout the user believes succeeded',
          countSessions(fixture.harness, issued.sessionId),
          1,
        );

        // And it is not merely present — it is still LIVE. The row survives with an expiry
        // twelve hours out, so the credential the browser or the Apple client still holds
        // continues to authenticate.
        const stores = createD1ControlPlaneStores(fixture.harness.database);
        const found = expectOk(
          'the session is still readable',
          await stores.identity.findSession(issued.sessionId),
        ) as { expiresAt: string; principalId: string } | null;
        assertTrue('the session record is still present', found !== null, 'the row vanished');
        assertEqual(
          'and it still names the same principal',
          found?.principalId,
          PRINCIPAL,
        );
        assertTrue(
          'and it has not expired — the credential is live for another twelve hours',
          (found?.expiresAt ?? '') > new Date(NOW_MS).toISOString(),
          `expiresAt was ${String(found?.expiresAt)} against a now of ${new Date(NOW_MS).toISOString()}`,
        );
      } finally {
        fixture.close();
      }
    },
  );

  suite.test('a repeated logout attempt stays refused — it does not eventually succeed', async () => {
    const fixture = createFixture(SESSION_ROW_WRITES);
    try {
      const issued = expectOk(
        'a session is issued',
        await fixture.sessions.issueSession({
          verifiedPrincipalId: PRINCIPAL,
          requestedOrganizationId: null,
        }),
      ) as { sessionId: string };

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        expectError(
          `attempt ${String(attempt)} is refused`,
          await fixture.sessions.revokeSession(issued.sessionId),
          quotaExceeded(),
        );
      }
      assertEqual(
        'the session survived all three',
        countSessions(fixture.harness, issued.sessionId),
        1,
      );
      assertTrue(
        'and the budget never went negative — no partial spend',
        fixture.remaining() === 0,
        `remaining was ${String(fixture.remaining())}`,
      );
    } finally {
      fixture.close();
    }
  });

  suite.test(
    'a partial budget is NOT partially spent — 2 of the 3 needed row-writes still refuses',
    async () => {
      // `0014` §A.9a: "NEVER partially create". The same must hold for a delete: a session row
      // removed from the table but not from its indexes would be worse than a refusal.
      const fixture = createFixture(SESSION_ROW_WRITES + 2);
      try {
        const issued = expectOk(
          'a session is issued, leaving 2 of the 3 row-writes revocation needs',
          await fixture.sessions.issueSession({
            verifiedPrincipalId: PRINCIPAL,
            requestedOrganizationId: null,
          }),
        ) as { sessionId: string };
        assertEqual('two row-writes remain', fixture.remaining(), 2);

        expectError(
          'a revocation that cannot be fully funded is refused outright',
          await fixture.sessions.revokeSession(issued.sessionId),
          quotaExceeded(),
        );
        assertEqual(
          'the row is untouched',
          countSessions(fixture.harness, issued.sessionId),
          1,
        );
      } finally {
        fixture.close();
      }
    },
  );

  suite.test('an unknown session identifier costs NOTHING and is not refused', async () => {
    // The other half of the collapse, and the reason the budget matters at all: a guessed
    // identifier must not be able to spend capacity, or logout becomes a free way for an
    // unauthenticated caller to drain the control plane's daily allowance.
    const fixture = createFixture(SESSION_ROW_WRITES);
    try {
      const before = fixture.remaining();
      expectOk(
        'an unknown session revokes successfully and silently',
        await fixture.sessions.revokeSession('ses_never_existed_00'),
      );
      assertEqual('no budget was spent', fixture.remaining(), before);
    } finally {
      fixture.close();
    }
  });

  suite.test(
    'RECORDED: the refusal and the success are indistinguishable to the caller',
    async () => {
      // `revokeHandler` discards the result of `revokeSession` and returns `cleared` on every
      // path, so these two internally-different outcomes reach the caller as one response. That
      // is `disclosure: 'collapsed'` working as designed AND the reason the failure above is
      // invisible. Asserted at the resolver, where the difference still exists, so that the
      // collapse is shown to be hiding something real rather than nothing.
      const funded = createFixture(1_000);
      const starved = createFixture(SESSION_ROW_WRITES);
      try {
        const a = expectOk(
          'session A is issued',
          await funded.sessions.issueSession({
            verifiedPrincipalId: PRINCIPAL,
            requestedOrganizationId: null,
          }),
        ) as { sessionId: string };
        const b = expectOk(
          'session B is issued',
          await starved.sessions.issueSession({
            verifiedPrincipalId: PRINCIPAL,
            requestedOrganizationId: null,
          }),
        ) as { sessionId: string };

        const successful = await funded.sessions.revokeSession(a.sessionId);
        const refused = await starved.sessions.revokeSession(b.sessionId);

        assertTrue(
          'the two outcomes genuinely differ at the resolver',
          successful.ok !== refused.ok,
          'the funded and starved revocations returned the same thing, so this case proves ' +
            'nothing about the collapse',
        );
        assertEqual('one deleted its row', countSessions(funded.harness, a.sessionId), 0);
        assertEqual('the other did not', countSessions(starved.harness, b.sessionId), 1);
      } finally {
        funded.close();
        starved.close();
      }
    },
  );

  return suite;
}
