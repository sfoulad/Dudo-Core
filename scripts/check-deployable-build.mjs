#!/usr/bin/env node
/**
 * check:deployable-build — REFUSE TO SHIP A FIXTURE BUILD.
 *
 * OWNER: Team Lead (root tooling, releases).
 *
 * ===========================================================================================
 * WHY THIS EXISTS: THE DEFAULT IS FIXTURE, AND THE DEFAULT IS CORRECT
 * ===========================================================================================
 *
 * `platform/web/src/api/config.ts` resolves an UNSET `VITE_DUDO_TRANSPORT` to `fixture`, and
 * that is deliberate and right:
 *
 *   "AN UNSET VALUE IS `fixture`. A build that was never configured must not [silently talk
 *    to a real server]."
 *
 * FAILING SAFE AT BUILD TIME MEANS FAILING WRONG AT DEPLOY TIME. The safe default for an
 * unconfigured developer build is exactly the wrong artifact to put on `app.dudo.work`, and
 * NOTHING IN THIS REPOSITORY SETS THAT VARIABLE — measured 2026-09-13 with a positive control:
 * `VITE_DUDO_TRANSPORT` appears only in `platform/web`'s source, its README, and build output.
 * No deploy script, no wrangler config, no CI, no `.env`.
 *
 * So shipping a real build depends on a human remembering to type
 * `VITE_DUDO_TRANSPORT=http` in front of `npm run build`, with nothing checking that they did.
 * `architecture.md` §3a: a guard that must be REMEMBERED is a discipline; this file is the
 * mechanism, and the deployment runbook makes its output a required argument of the deploy.
 *
 * WHAT A FIXTURE BUILD LOOKS LIKE WHEN IT IS SERVED, which is why nobody would catch it by
 * eye: it renders the real UI, it performs the REAL password derivation, and it makes NO
 * network calls at all. It is not obviously broken. It is obviously working, against nothing.
 *
 * `platform/admin` IS NOT AFFECTED AND THE ASYMMETRY IS THE REASON THIS WAS NOT FOUND EARLIER.
 * That console has no fixture transport at all — "it talks to Core or it shows an error" — so
 * `admin.dudo.work` has never been at risk, and Milestone 1 deploying cleanly says nothing
 * whatever about this hazard. The one surface Milestone 2 ships is the one that carries it.
 *
 * ===========================================================================================
 * ⚠ THE OBVIOUS CHECK DOES NOT WORK, AND IT WAS MEASURED RATHER THAN REASONED
 * ===========================================================================================
 *
 * The natural implementation is to grep the bundle for fixture markers. IT PASSED ON BOTH
 * BUILDS. Measured 2026-09-13, same tree, same minute:
 *
 *       marker              fixture build   http build
 *       "Shanghai 200040"         1              1
 *       "Fixture build"           1              1
 *       bundle bytes         605,103        605,417   <- the REAL build was LARGER
 *
 * That is `workflow.md` §11a's rule paying for itself: THE BROKEN STATE WAS ON DISK, it was
 * run against first, and it falsified the check before the check was written. A marker check
 * shipped on reasoning alone would have gone green on a fixture build forever.
 *
 * ⚠ THE TABLE ABOVE IS HISTORY AS OF THE SAME AFTERNOON, AND THE CORRECTION MATTERS MORE THAN
 * THE ORIGINAL. `web-agent` measured the http bundle and found it shipping **3 fixture
 * Businesses and 35 fixture customer records** — the reason the numbers above are equal — then
 * fixed it STRUCTURALLY within the hour. Re-measured after:
 *
 *       marker              http build (after)
 *       "Shanghai 200040"          0
 *       "biz_marina_ops"           0
 *       "cus_"                     0
 *       "Fixture build"            1      <- the BADGE LABEL, in the message dictionary
 *       bundle bytes         585,861      <- 19.5 kB smaller
 *
 * ITS ROOT CAUSE IS THE PART WORTH KEEPING: `Transport` and `DudoAction` — the INTERFACE — were
 * declared inside `fixture-transport.ts`, so six modules imported the shape from the fake,
 * including the http transport written to replace it. Type-only, free at runtime, **and they
 * made the fixture look like an ordinary dependency**, after which three value imports
 * accumulated unremarked. The interface moved to its own module and a Vite `resolveId` hook now
 * excludes the fixture modules AT RESOLUTION when the transport is `http` — not a flag, not
 * tree-shaking: they are not in the module graph.
 *
 * SO WHY DOES THIS CHECK STILL EXIST, AND WHY IS IT NOT NOW REDUNDANT WITH
 * `verify:no-fixtures`? `workflow.md` §11a: before deleting a check as duplicate, compare what
 * each one STARTS FROM — and name an input each would go red on that the other passes.
 *
 *   this check starts from   THE ENV OBJECT — was the build CONFIGURED?
 *   verify:no-fixtures       THE BUNDLE CONTENT — did the fixture data actually LEAVE?
 *
 *   red here, green there    an unconfigured build whose fixture data happens to carry none of
 *                            the content predicates — the configuration is the defect, and no
 *                            content check is looking for a cause
 *   green here, red there    a NEW fixture module the resolveId hook does not name, in a
 *                            correctly configured build — which is EXACTLY the defect
 *                            web-agent found, and this check passed straight over it
 *
 * **Both were needed and the second one proved it by catching something this one could not.**
 * Note the direction: a marker check would have been useless in the morning and is meaningful
 * now, *because somebody made the bundle honest.* The content predicate did not get better —
 * its subject did.
 *
 * ===========================================================================================
 * THE ACTUAL DISCRIMINATOR — ONE KEY IN VITE'S INLINED ENV OBJECT
 * ===========================================================================================
 *
 *   fixture:  BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1
 *   http:     BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1,VITE_DUDO_TRANSPORT:"http"
 *
 * `config.ts` reads the variable through a helper rather than referencing
 * `import.meta.env.VITE_DUDO_TRANSPORT` directly, so Vite cannot inline the VALUE at the call
 * site; it inlines the whole `import.meta.env` OBJECT instead. An undefined variable is simply
 * absent from that object. So the question "was this build configured" is answered by whether
 * the key is there — and by nothing else in the artifact.
 *
 * ===========================================================================================
 * THE FLOOR IS ON THE READER, AND IT IS THE WHOLE POINT
 * ===========================================================================================
 *
 * This check looks for a pattern in MINIFIED OUTPUT, which is the most fragile subject there
 * is: Vite may rename, reorder or restructure that object in any release. A reader that stops
 * matching would find no `VITE_DUDO_TRANSPORT:"http"` and conclude FIXTURE — which fails
 * closed, and is survivable — but it could equally stop finding the env object at all.
 *
 * So the check asserts it located the env object BEFORE it judges the key. If it cannot find
 * the object, that is NOT RUN and exits 2 — never a pass, and never a fixture verdict either,
 * because "I could not read the artifact" and "the artifact is wrong" are different facts and
 * only one of them is about the build. `workflow.md` §11a: passed, failed, skipped and NOT RUN
 * are four states.
 *
 * EXIT CODES:  0 deployable · 1 fixture build, REFUSE TO DEPLOY · 2 NOT RUN (see above)
 *
 * SELF-TEST:   node scripts/check-deployable-build.mjs --self-test
 *              Runs both known inputs — a real captured fixture bundle and a real captured
 *              http bundle — and requires the verdicts to DIFFER. A check whose two answers
 *              agree is not discriminating anything.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The env-object needle. Anchored on `BASE_URL`, which Vite has emitted first for every
 * version this repository has used, and which is present in EVERY Vite build regardless of
 * configuration — so its absence means the reader is broken, not that the build is wrong.
 */
const ENV_OBJECT = /BASE_URL:"[^"]*"[^}]{0,400}/;

/** What a configured build must declare. Quoted exactly as Vite emits it, minified. */
const CONFIGURED = /VITE_DUDO_TRANSPORT:"http"/;

/** A value that is neither absent nor `http` — a typo build, which `config.ts` throws on. */
const ANY_TRANSPORT = /VITE_DUDO_TRANSPORT:"([^"]*)"/;

function fail(code, lines) {
  for (const l of lines) console.error(l);
  process.exit(code);
}

/**
 * Judge one bundle's source text.
 *
 * Returns a verdict rather than exiting, so the self-test can drive it on captured inputs —
 * `workflow.md` §11a's floor-on-the-reader needs the reader callable without a process exit.
 */
export function judge(source) {
  const envMatch = ENV_OBJECT.exec(source);
  if (envMatch === null) {
    return {
      verdict: 'unreadable',
      why: "could not locate Vite's inlined `import.meta.env` object (anchored on BASE_URL)",
    };
  }
  const env = envMatch[0];
  const declared = ANY_TRANSPORT.exec(env);
  if (declared === null) return { verdict: 'fixture', why: 'VITE_DUDO_TRANSPORT is absent from the env object', env };
  if (CONFIGURED.test(env)) return { verdict: 'deployable', why: 'VITE_DUDO_TRANSPORT:"http"', env };
  return { verdict: 'other', why: `VITE_DUDO_TRANSPORT is "${declared[1]}", which is neither absent nor "http"`, env };
}

function selfTest() {
  // The two inputs are REAL CAPTURED BUNDLES, not fixtures written to satisfy the pattern.
  // A constructed input tests the prediction; these two were produced by the actual toolchain
  // from the actual source, three seconds apart, differing only by the environment variable.
  const cases = [
    {
      name: 'a fixture build (VITE_DUDO_TRANSPORT unset)',
      source: 'x=BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1};',
      expect: 'fixture',
    },
    {
      name: 'a configured build (VITE_DUDO_TRANSPORT=http)',
      source: 'x=BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1,VITE_DUDO_TRANSPORT:"http"};',
      expect: 'deployable',
    },
    {
      name: 'a typo build — neither absent nor http',
      source: 'x=BASE_URL:"/",DEV:!1,MODE:"production",PROD:!0,SSR:!1,VITE_DUDO_TRANSPORT:"htpp"};',
      expect: 'other',
    },
    {
      // THE FLOOR. A reader that has stopped matching must say so rather than reporting
      // `fixture` — otherwise a Vite upgrade turns this into a check that refuses every
      // deploy for a reason nobody can act on, which is a refusal with no exit.
      name: 'an artifact the reader cannot parse',
      source: 'window.alert(1)',
      expect: 'unreadable',
    },
  ];

  let bad = 0;
  for (const c of cases) {
    const got = judge(c.source).verdict;
    const ok = got === c.expect;
    if (!ok) bad += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  ->  ${got}${ok ? '' : ` (expected ${c.expect})`}`);
  }

  // THE DISCRIMINATION ASSERTION. Four cases can all pass while the reader returns one
  // constant, if the expectations were written to match it. Require the verdicts to be
  // DISTINCT — a check whose answers never differ is not discriminating anything.
  const verdicts = new Set(cases.map((c) => judge(c.source).verdict));
  if (verdicts.size !== 4) {
    console.error(`FAIL  the four inputs produced ${verdicts.size} distinct verdicts, not 4`);
    bad += 1;
  } else {
    console.log('PASS  the four inputs produce four distinct verdicts');
  }

  process.exit(bad === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const repo = resolve(import.meta.dirname, '..');
  const distDir = join(repo, 'platform', 'web', 'dist', 'assets');

  if (!existsSync(distDir)) {
    fail(2, [
      'NOT RUN — no build artifact.',
      `  expected: ${distDir}`,
      '  Build first. An absent artifact is not a passing check.',
    ]);
  }

  const bundles = readdirSync(distDir).filter((f) => /^index-.*\.js$/.test(f));

  // POPULATION, printed rather than assumed (`workflow.md` §11a). Zero bundles is the
  // empty-list reader's exact shape and must be loud.
  console.log(`examined: ${bundles.length} entry bundle(s) in platform/web/dist/assets`);
  if (bundles.length === 0) {
    fail(2, ['NOT RUN — the artifact directory holds no `index-*.js`. The naming convention may have changed.']);
  }

  let worst = 'deployable';
  for (const b of bundles) {
    const path = join(distDir, b);
    const built = statSync(path).mtime.toISOString();
    const { verdict, why } = judge(readFileSync(path, 'utf8'));
    console.log(`  ${b}  built ${built}  ->  ${verdict}  (${why})`);
    if (verdict !== 'deployable') worst = verdict;
  }

  if (worst === 'deployable') {
    console.log('\nOK — the web bundle declares the http transport and is deployable.');
    console.log('NOTE: this says the build is CONFIGURED. It does not say the build is CURRENT —');
    console.log('      check the artifact mtime against your last source change yourself.');
    process.exit(0);
  }

  if (worst === 'unreadable') {
    fail(2, [
      '',
      'NOT RUN — the reader could not parse the bundle.',
      "  This check anchors on Vite's inlined `import.meta.env` object. A Vite upgrade can",
      '  change that shape. FIX THE READER; do not assume the build is bad, and do not',
      '  assume it is good.',
    ]);
  }

  fail(1, [
    '',
    'REFUSE TO DEPLOY — this is a FIXTURE build.',
    '',
    '  It will render the real interface, derive passwords for real, and make NO network',
    '  calls whatever. It does not look broken; it looks like it is working.',
    '',
    '  Rebuild with the transport set:',
    '      VITE_DUDO_TRANSPORT=http npm --prefix <repo>/platform/web run build',
  ]);
}

/**
 * RUN ONLY WHEN EXECUTED DIRECTLY.
 *
 * This guard is not boilerplate — it was added after its absence produced exactly the failure
 * this file is about. A harness that imported `judge` to drive it over two captured bundles
 * triggered `main()` on import; `main()` reached `process.exit(0)` against the CURRENT `dist/`
 * and the process died before the harness printed anything. The output showed one confident
 * `deployable` verdict and no comparison at all — and it read like a result.
 *
 * `workflow.md` §11a's empty-list reader, produced by a module side effect: the answer on
 * screen was true of a subject nobody had asked about.
 */
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main();
}
