/**
 * ===========================================================================================
 * IS ANY TENANT-ADMIN OPERATION REACHABLE BY ANY PRINCIPAL ALIVE?
 * ===========================================================================================
 *
 * **No. 21 of 21 declared permissions are granted by no role in `roles.ts`.** Measured, not
 * inferred, and printed on every run.
 *
 * This exists because *"blocked on the grant"* had been travelling as prose for a day, and prose
 * cannot say **how** blocked or **whether that changed**. A number can, and this one moves the
 * moment the grant lands.
 *
 * ===========================================================================================
 * WHAT PROMPTED IT: A CONTRACT SAYING THE OPPOSITE, IN THE SENTENCE THAT MATTERS MOST
 * ===========================================================================================
 *
 * `tenant-sessions-v1.contract.yaml`, on `tenant.members.sessions.list`:
 *
 *   > *"The permission IS held — `core.session.list` sits on `owner`, `admin` and
 *   >  `business-admin` in the catalogue — so **unlike most of this directory, this operation is
 *   >  not additionally blocked on a grant**."*
 *
 * **Measured: the string `session` appears ZERO times in `platform/core/authorization/roles.ts`.**
 * It is blocked on a grant exactly like the other twenty.
 *
 * > **`security.md` §8-0 recurring: a permission DECLARED in the catalogue read as a permission
 * > GRANTED.** The catalogue's role blocks are declarations; **Core's transcription is the
 * > grant**, and §8-0 exists because those are indistinguishable at a glance.
 *
 * **And I relayed that sentence as evidence without opening `roles.ts`** — `architecture.md`
 * §3c's reader's half: *verifying that a contract says something is not verifying that it is
 * true.* The Team Lead measured it. **This file is what stops the next such sentence being
 * believed**, because the number here contradicts it without anybody having to notice the prose.
 *
 * ===========================================================================================
 * AND THE SCOPE ARGUMENT AGAINST `business-admin` IS RIGHT IN ITS CONCLUSION AND WRONG IN ITS
 * MECHANISM — measured, because it would otherwise become the next quoted sentence
 * ===========================================================================================
 *
 * The claim was that `core.session.list` declaring `scopes: [organization, own]` makes it
 * **unholdable** by a business-scope role. Driven through Core's own `implies`:
 *
 * ```
 * implies(business, organization) = false
 * implies(business, own)          = TRUE      <- so business CAN hold it, at `own`
 * ```
 *
 * **A `business-admin` may hold `core.session.list` at `own` — "list MY sessions" — legitimately.**
 * What it cannot do is satisfy `tenant.members.sessions.list`, which lists **another member's**
 * sessions and therefore needs `organization`; a business-scope grant does not reach it.
 *
 * > **Same conclusion, different mechanism — and the difference is load-bearing**, because
 * > *"cannot hold the permission"* would justify removing it from the role, while *"can hold it
 * > at a narrower scope that does not reach this route"* is a fact about the ROUTE. `registry-
 * > coherence.ts`'s CHECK 1 correctly does NOT flag this pair, and this note is why.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { MEMBERSHIP_ROLES, grantsForRole } from '../../../../platform/core/authorization/roles.ts';
import { operationsIn } from './registration-refusals.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CONTRACT_TREE = 'packages/contracts/core/tenant-admin';

/** Every permission the tenant-admin contracts require, to the operations that require it. */
export function declaredPermissions(): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  if (!existsSync(REPO + CONTRACT_TREE)) return declared;
  for (const file of readdirSync(REPO + CONTRACT_TREE).filter((name) => name.endsWith('.contract.yaml'))) {
    for (const operation of operationsIn(file, readFileSync(`${REPO}${CONTRACT_TREE}/${file}`, 'utf8'))) {
      for (const permissionId of operation.permissions) {
        const owners = declared.get(permissionId) ?? [];
        owners.push(operation.id);
        declared.set(permissionId, owners);
      }
    }
  }
  return declared;
}

/** Every permission ANY seed role grants. Derived, so a role's grants changing moves with it. */
export function grantedByAnyRole(): Set<string> {
  const granted = new Set<string>();
  for (const role of MEMBERSHIP_ROLES) {
    for (const grant of grantsForRole(role).grants) granted.add(grant.permissionId);
  }
  return granted;
}

export function buildGrantReachabilitySuite(): Suite {
  const suite = new TestSuite('tenant-admin — is any operation reachable by any principal alive?');

  suite.test('THE MEASUREMENT — declared against granted, printed whatever the answer is', () => {
    const declared = declaredPermissions();
    const granted = grantedByAnyRole();
    const ungranted = [...declared.keys()].filter((permissionId) => !granted.has(permissionId)).sort();

    console.log(
      `      tenant-admin contracts declare ${String(declared.size)} distinct permission(s)\n` +
        `      Core's ${String(MEMBERSHIP_ROLES.length)} seed roles grant ${String(granted.size)} in total\n` +
        `      UNGRANTED BY EVERY ROLE: ${String(ungranted.length)} of ${String(declared.size)}`,
    );
    for (const permissionId of ungranted) {
      console.log(`        ${permissionId.padEnd(42)} needed by ${String(declared.get(permissionId)?.length ?? 0)} operation(s)`);
    }

    // THE FLOOR. Zero declared permissions and zero ungranted render identically, and the first
    // means the reader broke — `operationsIn` is shared with `registration-refusals.ts`, so a
    // change there lands here silently.
    assertTrue(
      'floor: the contract reader found permissions to measure',
      declared.size > 0,
      'ZERO permissions were read from the tenant-admin contracts. Eight contract sets exist, so ' +
        'this is the reader rather than the corpus — and a reader that finds nothing reports ' +
        'perfect reachability.',
    );
    assertTrue(
      'floor: the role reader found grants',
      granted.size > 0,
      "Core's seed roles grant NOTHING at all, which would make every permission ungranted for a " +
        'reason unrelated to the tenant-admin surface.',
    );
  });

  suite.test('PIN — 21 of 21 tenant-admin permissions are granted by NO role. Move it when the grant lands', () => {
    // ===================================================================================
    // A PIN RATHER THAN A FAILURE, DELIBERATELY, AND THE REASON IS NOT COMFORT.
    // ===================================================================================
    //
    // The eighteen-permission grant is **with the user**. A red here would be a permanently-red
    // gate on a decision that is not the team's to make — and `package.json`'s standing rule is
    // that a red gate folded into a green one makes the green one worthless.
    //
    // **But a silent green is worse**, because *"the tenant-admin suite passes"* would then be
    // true of a surface where **every operation is refused to every principal alive**. So the
    // number is pinned: it moves only when somebody edits this line, and editing it means having
    // read what was granted.
    //
    // *** WHAT THIS NUMBER MEANS, AND IT IS STRONGER THAN THE ROUTE COUNT. ***
    // `TENANT_ADMIN_ROUTE_COUNT = 0` says nothing is *registered*. **This says that even if every
    // route were registered tomorrow, every one would be refused at authorization** — because
    // `authorize()` denies by default and no role holds any of these. **Two independent reasons
    // the surface is unreachable, and closing one closes nothing.**
    const declared = declaredPermissions();
    const granted = grantedByAnyRole();
    const ungranted = [...declared.keys()].filter((permissionId) => !granted.has(permissionId));

    assertEqual(
      'PIN: distinct tenant-admin permissions declared by contracts',
      declared.size,
      21,
    );
    assertEqual(
      'PIN: how many of them ANY role grants — zero, and the day this moves the pin above moves too',
      declared.size - ungranted.length,
      0,
    );
  });

  suite.test('THE CONTRACT CLAIM THAT SAYS OTHERWISE — asserted, so the sentence cannot outlive the fact', () => {
    // `tenant-sessions-v1` tells a reader that `core.session.list` needs no grant. It does.
    // **The prose is `m2-contracts`' to repair; this assertion is what stops it being believed
    // in the meantime**, and it goes red the day the grant lands — at which point the sentence
    // becomes true and both should change together.
    const granted = grantedByAnyRole();
    assertTrue(
      'core.session.list is NOT granted by any role — the contract says it is',
      !granted.has('core.session.list'),
      'core.session.list IS now granted. `tenant-sessions-v1`\'s claim has become true, so this ' +
        'assertion has served its purpose and should be removed IN THE SAME CHANGE — a check ' +
        'asserting a defect that no longer exists is a pessimistic stale pin (`§11a`).',
    );
    console.log(
      "      `session` appears 0 times in platform/core/authorization/roles.ts — measured, and it " +
        'is the whole basis for the assertion above.',
    );
  });

  return suite;
}
