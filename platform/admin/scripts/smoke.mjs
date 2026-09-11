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
  /*
   * ⚠ THIS ASSERTED `/` REDIRECTS TO `/organizations` AND WENT RED WHEN `/`
   * BECAME THE DASHBOARD. Updated 2026-09-11.
   *
   * **The redirect was never the property; it was how the property happened to
   * be arranged.** What this case is for is that the address is a PATH — no
   * `#` — which is what the router migration bought and what a hash history
   * makes impossible to get wrong. `/` now RENDERS rather than redirects, so
   * the assertion is that the address stayed `/` and carries no fragment.
   *
   * `workflow.md` §12, on my own change: I moved the behaviour and the
   * assertion describing the old one was still here.
   */
  note(
    'the address is a PATH with no fragment, and `/` renders rather than redirecting',
    (await page.url()) === '/' && !(await page.url()).includes('#'),
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
   *
   * **THAT IS NOW DONE, AND IT IS A DIFFERENT CASE FROM THIS ONE.** A route
   * that does not MATCH still falls back here; a route that matches with an
   * identifier that does not RESOLVE is a not-found state the detail screen
   * owns. The two failures look alike from the address bar and are not the
   * same thing.
   *
   * **The home section is `/` now** — it was `/organizations` — because the
   * dashboard answers "what is the state of the platform" rather than spending
   * a paginated read on a question the arriver may not have asked.
   */
  await page.goto('/nowhere-at-all', 2600);
  note(
    'unknown path redirects to the home section rather than a dead end',
    (await page.url()) === '/',
    `url: ${await page.url()}`,
  );

  section('4. Arabic flips the document, and only a browser can say so');
  /*
   * ===================================================================
   * THIS IS WHY THE HARNESS IS COMMITTED. NOTHING ELSE CAN SEE IT.
   * ===================================================================
   *
   * `tsc` cannot tell whether `dir` reached `<html>`. The CSS check proves the
   * stylesheet uses no physical inline-axis property, which is necessary and
   * **not sufficient** — logical properties resolve against a direction that
   * something has to actually set, and a provider mounted in the wrong place
   * sets it on a subtree while the document stays LTR.
   *
   * So this drives the real switcher in a real browser and reads the real
   * attributes off `document.documentElement`.
   *
   * **AND IT ASSERTS THE ENGLISH SIDE FIRST**, because "dir is rtl" passing
   * would mean nothing if the console were rtl all along — a control, not a
   * courtesy.
   */
  await page.goto('/', 3000);
  note(
    'the document starts in English, left-to-right',
    (await page.evaluate('document.documentElement.getAttribute("dir")')) === 'ltr' &&
      (await page.evaluate('document.documentElement.getAttribute("lang")')) === 'en',
    `lang=${await page.evaluate('document.documentElement.getAttribute("lang")')} dir=${await page.evaluate('document.documentElement.getAttribute("dir")')}`,
  );

  /*
   * The switch is driven the way an operator drives it — the native `<select>`
   * with a real `change` event — rather than by calling `setLocale`. A test
   * that reaches past the control proves the state machine works and says
   * nothing about whether anyone can operate it.
   */
  const switched = await page.evaluate(`(() => {
    const select = document.querySelector('select');
    if (select === null) return 'no-select';
    select.value = 'ar';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return 'dispatched';
  })()`);
  note('the language control exists and is a native select', switched === 'dispatched', `result: ${String(switched)}`);

  await page.sleep(400);
  note(
    'choosing Arabic sets lang and dir ON THE DOCUMENT, not on a wrapper',
    (await page.evaluate('document.documentElement.getAttribute("dir")')) === 'rtl' &&
      (await page.evaluate('document.documentElement.getAttribute("lang")')) === 'ar',
    `lang=${await page.evaluate('document.documentElement.getAttribute("lang")')} dir=${await page.evaluate('document.documentElement.getAttribute("dir")')}`,
  );

  /*
   * THE COMPUTED DIRECTION, NOT THE ATTRIBUTE. `dir="rtl"` on `<html>` is a
   * request; `getComputedStyle` is what the engine actually resolved, and it is
   * the value every logical property in the stylesheet is measured against.
   */
  note(
    'and the engine resolved it — logical properties now flip',
    (await page.evaluate('getComputedStyle(document.body).direction')) === 'rtl',
    `computed: ${await page.evaluate('getComputedStyle(document.body).direction')}`,
  );

  /* The choice survives a reload, which is the whole point of persisting it. */
  await page.goto('/', 2600);
  note(
    'and the choice survives a reload',
    (await page.evaluate('document.documentElement.getAttribute("dir")')) === 'rtl',
    `dir=${await page.evaluate('document.documentElement.getAttribute("dir")')}`,
  );

  section('5. The named viewports — iPad is a target, not a guess');
  /*
   * ===================================================================
   * MEASURED AT REAL WIDTHS, BECAUSE A BREAKPOINT IS NOT A LAYOUT
   * ===================================================================
   *
   * Reading `lg:` out of the source proves a class was written. It does not
   * prove that at 768 CSS pixels the sidebar is hidden, the drawer toggle is
   * reachable and nothing overflows the viewport horizontally. **Only a browser
   * at that width can say so**, and iPad portrait is a named target rather
   * than an inference from "tablet".
   *
   * THE ASSERTION THAT EARNS ITS KEEP IS THE OVERFLOW ONE. A table that is
   * 40 pixels too wide produces a page that scrolls sideways — the single most
   * common way a responsive admin console fails, invisible at desktop width,
   * and invisible to every check that reads source.
   */
  const VIEWPORTS = [
    { label: 'iPad portrait', width: 768, height: 1024 },
    { label: 'iPad landscape', width: 1024, height: 768 },
    { label: 'desktop', width: 1440, height: 900 },
  ];
  for (const viewport of VIEWPORTS) {
    await page.emulate({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.goto('/', 2200);
    const overflow = await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    );
    note(
      `${viewport.label} (${String(viewport.width)}px) does not scroll sideways`,
      Number(overflow) <= 0,
      `horizontal overflow: ${String(overflow)}px`,
    );
  }

  section('6. Nothing threw');
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
