/**
 * ===========================================================================================
 * THE ACCOUNT-EXISTENCE TIMING MEASUREMENT. `docs/decisions/0015` §C.3.
 * ===========================================================================================
 *
 *   node packages/testing/run-az2-timing.ts [samples-per-branch]
 *
 * WHAT THIS IS AND IS NOT. It is a measurement, not a test, and it is deliberately not part of
 * `run-az2-login.ts`: a wall-clock threshold on a shared developer laptop fails for reasons that
 * have nothing to do with the code, and a suite that goes red under load teaches a team to
 * ignore red. The structural proof of equal work lives in
 * `suites/az2-login/equal-work.ts`, which observes the derivation parameters directly and holds
 * on any machine. THIS PROGRAM IS THE CORROBORATION, NOT THE EVIDENCE.
 *
 * ===========================================================================================
 * WHY A MEDIAN IS NOT ENOUGH, AND WHAT IS PRINTED INSTEAD
 * ===========================================================================================
 *
 * An attacker measuring an existence oracle does not measure the median. They measure whatever
 * separates the two populations — a shifted tail, a bimodal cluster, a rare slow branch — and a
 * ratio of medians can be 0.97 while the 99th percentiles differ by an order of magnitude. So
 * this prints the FULL percentile ladder for both branches, min and max, the mean, and the
 * per-percentile difference, and it also prints a rank-sum overlap statistic:
 *
 *   AUC (the probability that a randomly chosen HIT sample exceeds a randomly chosen MISS
 *   sample) is 0.5 for two indistinguishable populations. It is the honest summary of "can an
 *   attacker classify a single observation", which the median cannot answer at all.
 *
 * ===========================================================================================
 * MEASUREMENT DISCIPLINE
 * ===========================================================================================
 *
 * * `performance.now()`, not `Date.now()`. `0015` finding 3 records that `Date.now()` is frozen
 *   during synchronous Worker execution; this program runs under NODE against the real modules
 *   for exactly that reason, and says so rather than pretending it measured a Worker.
 * * SAMPLES ARE INTERLEAVED, hit-then-miss, never blocked. A blocked design attributes any
 *   thermal drift, GC pause or CPU frequency change entirely to whichever branch ran second.
 * * A warm-up pass is discarded before recording, so JIT compilation does not land on one branch.
 * * The store is an IN-MEMORY SQLite fixture. That is a limitation and it is stated plainly:
 *   this measures the CPU half of the property. The D1 I/O half is covered by the 250 ms
 *   response floor in `pre-auth-admission.ts` and is not measurable here.
 */

import { performance } from 'node:perf_hooks';
import {
  createControlPlaneDatabase,
  createStubIdentifierHasher,
  seedCredential,
  seedPrincipal,
} from './harness/control-plane-fixture.ts';
import { createD1CredentialStore } from '../../platform/core/identity/adapters/d1/d1-credential-store.ts';
import { normalizeIdentifier } from '../../platform/core/identity/credential-store.ts';
import {
  SERVER_KDF_ITERATIONS,
  SUPPORTED_ALGORITHM,
  createCredentialVerifier,
} from '../../platform/core/identity/credential-verifier.ts';
import type { CredentialStore } from '../../platform/core/identity/credential-store.ts';

const ENROLLED_EMAIL = 'enrolled@example.invalid';
const ABSENT_EMAIL = 'absent@example.invalid';
const WRONG_VALUE = 'A'.repeat(43);
const PRINCIPAL = 'prn_timing_0001';

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[index];
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * The probability that a random sample from `a` exceeds a random sample from `b`, ties counted
 * as one half. 0.5 means the two populations are indistinguishable to a single observation.
 */
function areaUnderCurve(a: readonly number[], b: readonly number[]): number {
  let greater = 0;
  let tied = 0;
  for (const left of a) {
    for (const right of b) {
      if (left > right) greater += 1;
      else if (left === right) tied += 1;
    }
  }
  return (greater + tied / 2) / (a.length * b.length);
}

function format(value: number): string {
  return value.toFixed(4).padStart(9);
}

function ladder(label: string, samples: readonly number[]): void {
  const sorted = [...samples].sort((left, right) => left - right);
  console.log(
    `  ${label.padEnd(6)}` +
      ` n=${String(samples.length).padStart(4)}` +
      ` min=${format(sorted[0])}` +
      ` p10=${format(percentile(sorted, 0.1))}` +
      ` p25=${format(percentile(sorted, 0.25))}` +
      ` p50=${format(percentile(sorted, 0.5))}` +
      ` p75=${format(percentile(sorted, 0.75))}` +
      ` p90=${format(percentile(sorted, 0.9))}` +
      ` p99=${format(percentile(sorted, 0.99))}` +
      ` max=${format(sorted[sorted.length - 1])}` +
      ` mean=${format(mean(samples))}`,
  );
}

/**
 * A store with NO I/O at all. Both branches return an already-built value from a closure.
 *
 * ===========================================================================================
 * WHY THIS ARM EXISTS: TO ATTRIBUTE THE RESIDUAL RATHER THAN ARGUE ABOUT IT.
 * ===========================================================================================
 *
 * The SQLite arm's hit branch does a real row read and its miss branch does not, so any residual
 * difference it shows has two possible causes and the measurement cannot separate them. This arm
 * removes the store entirely: both branches return in constant time, so whatever difference
 * remains is attributable to `verify` itself.
 *
 * READ THE TWO ARMS TOGETHER. If the SQLite arm shows a residual and this one does not, the
 * residual is THE LOOKUP — which is the I/O half `credential-verifier.ts` explicitly does not
 * claim to close and `pre-auth-admission.ts`'s 250 ms floor covers. If THIS arm shows one, that
 * is the CPU half and it would contradict the structural trace.
 */
function createConstantTimeStore(identifierHash: string): CredentialStore {
  const record = {
    identifierHash,
    principalId: PRINCIPAL,
    algorithm: SUPPORTED_ALGORITHM,
    iterations: SERVER_KDF_ITERATIONS,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA',
    verifier: 'B'.repeat(43),
  };
  return {
    async findByIdentifierHash(hash: string) {
      return { ok: true as const, value: hash === identifierHash ? record : null };
    },
  };
}

type Arm = {
  readonly label: string;
  readonly note: string;
  readonly verify: (identifier: string, value: string) => Promise<unknown>;
  close(): void;
};

async function measure(arm: Arm, samples: number): Promise<number> {
  // Warm-up, discarded. 50 of each so the JIT has settled on both branches equally.
  for (let index = 0; index < 50; index += 1) {
    await arm.verify(ENROLLED_EMAIL, WRONG_VALUE);
    await arm.verify(ABSENT_EMAIL, WRONG_VALUE);
  }

  const hits: number[] = [];
  const misses: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    // Interleaved, and the ORDER ALTERNATES each iteration so that neither branch is
    // systematically the one that pays for a cache line the other warmed.
    if (index % 2 === 0) {
      const h0 = performance.now();
      await arm.verify(ENROLLED_EMAIL, WRONG_VALUE);
      hits.push(performance.now() - h0);
      const m0 = performance.now();
      await arm.verify(ABSENT_EMAIL, WRONG_VALUE);
      misses.push(performance.now() - m0);
    } else {
      const m0 = performance.now();
      await arm.verify(ABSENT_EMAIL, WRONG_VALUE);
      misses.push(performance.now() - m0);
      const h0 = performance.now();
      await arm.verify(ENROLLED_EMAIL, WRONG_VALUE);
      hits.push(performance.now() - h0);
    }
  }

  console.log(`\n  --- ${arm.label} ---`);
  console.log(`  ${arm.note}\n`);
  ladder('HIT', hits);
  ladder('MISS', misses);

  const sortedHits = [...hits].sort((a, b) => a - b);
  const sortedMisses = [...misses].sort((a, b) => a - b);
  console.log('\n  Per-percentile difference (HIT minus MISS), milliseconds:');
  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    const difference = percentile(sortedHits, fraction) - percentile(sortedMisses, fraction);
    const ratio = percentile(sortedHits, fraction) / percentile(sortedMisses, fraction);
    console.log(
      `    p${String(Math.round(fraction * 100)).padStart(2)}  ${format(difference)} ms` +
        `   ratio ${ratio.toFixed(4)}`,
    );
  }

  const auc = areaUnderCurve(hits, misses);
  console.log(
    `\n  AUC(hit > miss) = ${auc.toFixed(4)}   |AUC - 0.5| = ${Math.abs(auc - 0.5).toFixed(4)}`,
  );
  return auc;
}

async function main(): Promise<void> {
  const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
  const requested = Number(argv[2] ?? '400');
  const samples = Number.isInteger(requested) && requested > 0 ? requested : 400;

  const identifiers = createStubIdentifierHasher();
  const identifierHash = await identifiers.hash(normalizeIdentifier(ENROLLED_EMAIL));

  const harness = createControlPlaneDatabase();
  seedPrincipal(harness, PRINCIPAL);
  seedCredential(harness, {
    identifierHash,
    principalId: PRINCIPAL,
    algorithm: SUPPORTED_ALGORITHM,
    iterations: SERVER_KDF_ITERATIONS,
    salt: 'AAAAAAAAAAAAAAAAAAAAAA',
    verifier: 'B'.repeat(43),
  });
  const sqliteVerifier = await createCredentialVerifier({
    credentials: createD1CredentialStore(harness.database),
    identifiers,
  });
  const constantVerifier = await createCredentialVerifier({
    credentials: createConstantTimeStore(identifierHash),
    identifiers,
  });

  console.log('\n=== AZ2 — account-existence timing measurement ===\n');
  console.log(
    '  Node ' +
      String((globalThis as { process?: { version: string } }).process?.version ?? 'unknown') +
      `, ${String(SERVER_KDF_ITERATIONS)} server iterations, performance.now(), interleaved,` +
      `\n  ${String(samples)} samples per branch per arm. TWO ARMS, and they must be read together.`,
  );

  const sqliteAuc = await measure(
    {
      label: 'ARM 1: SQLITE STORE — verifier + a real row read',
      note:
        'The hit branch reads a row and the miss branch does not, so a residual here has two\n' +
        '  possible causes and this arm alone cannot separate them.',
      verify: (identifier, value) => sqliteVerifier.verify(identifier, value),
      close: () => {
        harness.close();
      },
    },
    samples,
  );

  const constantAuc = await measure(
    {
      label: 'ARM 2: CONSTANT-TIME STORE — the verifier alone',
      note:
        'No I/O on either branch. Whatever difference remains is attributable to verify()\n' +
        '  itself, which is the half credential-verifier.ts actually claims to close.',
      verify: (identifier, value) => constantVerifier.verify(identifier, value),
      close: () => {},
    },
    samples,
  );

  harness.close();

  console.log('\n  --- ATTRIBUTION ---\n');
  console.log(
    `  ARM 1 (with the lookup): |AUC - 0.5| = ${Math.abs(sqliteAuc - 0.5).toFixed(4)}\n` +
      `  ARM 2 (verifier alone): |AUC - 0.5| = ${Math.abs(constantAuc - 0.5).toFixed(4)}\n`,
  );
  console.log(
    '  If ARM 2 is materially closer to 0.5 than ARM 1, the residual is THE LOOKUP — the I/O\n' +
      "  half credential-verifier.ts explicitly does not claim, covered by the 250 ms floor.\n" +
      '  If ARM 2 is not closer, the residual is in the CPU path and would contradict the\n' +
      '  structural trace in suites/az2-login/equal-work.ts — investigate before shipping.\n',
  );
  console.log(
    '  READ THIS BEFORE QUOTING ANY NUMBER. A ratio near 1.0 is consistent with equal work but\n' +
      '  does not prove it, and a ratio away from 1.0 on a loaded machine does not disprove it.\n' +
      '  The binding evidence is the structural trace, not this program.\n',
  );
}

await main();
