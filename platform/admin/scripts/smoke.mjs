/**
 * `platform/admin` — the browser check.
 *
 *   npm run build && npm run smoke
 *
 * ===========================================================================
 * THIS FILE EXISTS BECAUSE OF WHAT IT CAUGHT IN THIS CONSOLE
 * ===========================================================================
 *
 * On the day the router migration landed:
 *
 * > **`tsc` 0, `vite build` 0, `npm run verify` 584 assertions passing and zero
 * > failing — and the console was a blank page.**
 *
 * `ReferenceError: Cannot access 'Mn' before initialization`. A circular import:
 * `route-tree → root-layout → AdminShell → route-tree`, created by putting the
 * section paths beside the routes that use them, which is where they read as
 * belonging.
 *
 * **A module cycle is legal TypeScript and legal ES, and it is a property of the
 * IMPORT GRAPH rather than of any file.** No instrument that inspects a file can
 * see it. The 33 assertions in `verify-platform.mjs` that read screen source all
 * passed, *correctly* — every file they read was fine. **The composition was
 * broken, and the composition is not written down anywhere.**
 *
 * A second bug the same run found: `redirect()` thrown from a component body
 * throws where the router is not listening, so an unmatched address simply
 * stayed put. **Legal, typed, silent.**
 *
 * ===========================================================================
 * ⚠ WHAT A PASS HERE DOES NOT MEAN
 * ===========================================================================
 *
 * **This console has no fixture transport, deliberately** — `api/config.ts`:
 * *"a fixture transport is a fake API by another name."* Unlike the customer
 * application there is no fictional platform to show. So with no Core running,
 * `useOperatorSession`'s probe fails and the gate renders its own state.
 *
 * **THE ROUTED SECTIONS ARE THEREFORE NOT REACHABLE HERE.** A pass proves the
 * router boots, the SPA fallback serves, and nothing throws. **It does not prove
 * that Organizations, Templates, Operators or the audit feeds render** — that
 * needs a live Core and is a deployed check.
 *
 * Read this as *"the application starts and routes"*, never as *"the console
 * works"*.
 *
 * ===========================================================================
 * FOUR STATES: 0 passed · 1 failed · 2 NOT RUN (no browser, nothing verified)
 * ===========================================================================
 */

import { withBrowser, createReporter } from '../../web/scripts/lib/browser-harness.mjs';

/*
 * THE DRIVER IS IMPORTED, NOT COPIED, and by relative path because these are two
 * npm packages that do not depend on each other. Copying ~200 lines of CDP
 * plumbing into both would be the duplication ADR 0040 spent a day removing, and
 * this console has already paid for that pattern once: its `verify-kdf.mjs`
 * carried a drift check over three files and not the file it lived in, which is
 * how two suites diverged while the code they tested stayed byte-identical.
 *
 * If a third consumer appears, the driver earns its own package. Two does not.
 */

const PACKAGE_DIRECTORY = new URL('..', import.meta.url).pathname;

const exitCode = await withBrowser({ packageDirectory: PACKAGE_DIRECTORY, port: 5200 }, async (page) => {
  const report = createReporter();
  const { note, section } = report;

  section('1. The console mounts');
  await page.goto('/', 3000);
  note(
    'React mounted — the check that would have caught the circular import',
    (await page.evaluate('document.getElementById("root").children.length')) > 0,
  );
  note(
    'the address is a PATH and `/` redirected to the home section',
    (await page.url()) === '/organizations',
    `url: ${await page.url()}`,
  );
  const body = await page.text();
  note('the session gate rendered its own state rather than a blank page', body.length > 20, `body: ${body.slice(0, 110)}`);

  section('2. Deep links are served — the property hash history made impossible to get wrong');
  /*
   * Under hash history the Worker never saw the route, so a deep link could not
   * 404 at the edge. Under path routing it can, and the only thing preventing it
   * is `not_found_handling: "single-page-application"` in `wrangler.admin.jsonc`.
   */
  for (const path of [
    '/organizations',
    '/templates',
    '/operators',
    '/audit',
    '/organizations/org_x/audit',
  ]) {
    await page.goto(path, 2200);
    const mounted = (await page.evaluate('document.getElementById("root").children.length')) > 0;
    const at = await page.url();
    note(`${path} is served and mounts`, mounted && at === path, `url: ${at}  mounted: ${String(mounted)}`);
  }

  section('3. An unmatched address falls back to home, as this console always did');
  /*
   * PRESERVED, NOT CHOSEN. `App.tsx` behaved this way and flagged itself:
   * "worth revisiting when routes take identifiers — /organizations/:id for an
   * Organization that does not exist is a genuine not-found and must say so."
   * Routes take identifiers now, and the Team Lead has ruled that a correctness
   * fix, owed as its own change rather than smuggled into a stack migration.
   */
  await page.goto('/nowhere-at-all', 2600);
  note(
    'unknown path redirects to the home section rather than a dead end',
    (await page.url()) === '/organizations',
    `url: ${await page.url()}`,
  );

  section('4. Nothing threw');
  /*
   * A FAILED API PROBE IS EXPECTED HERE and is filtered — there is no Core on a
   * local preview and this console has no fixture. Everything else is not.
   */
  const exceptions = page.exceptions.filter((e) => !/favicon/i.test(e));
  const errors = page.consoleErrors.filter(
    (e) => !/favicon|React DevTools|Failed to load resource|net::ERR/i.test(e),
  );
  note('no uncaught exception', exceptions.length === 0, exceptions.join('\n        '));
  note('no console error beyond the expected failed API probe', errors.length === 0, errors.join('\n        '));

  console.log('');
  console.log('  REMINDER: this proves the router boots and the fallback serves.');
  console.log('  It does NOT prove the sections render — no fixture transport by');
  console.log('  deliberate decision, so that is a deployed check against a live Core.');

  return report.summarise();
});

process.exit(exitCode);
