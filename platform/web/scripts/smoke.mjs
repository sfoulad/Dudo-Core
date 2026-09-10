/**
 * `platform/web` — the browser check.
 *
 *   npm run build && npm run smoke
 *
 * ===========================================================================
 * WHAT THIS INSTRUMENT SEES THAT NO OTHER ONE HERE CAN
 * ===========================================================================
 *
 * Every other check in this package inspects source or types. This one loads the
 * page. The difference is not theoretical — in `platform/admin`, on the day the
 * router migration landed:
 *
 * > **`tsc` 0, `vite build` 0, `npm run verify` 584 assertions passing and zero
 * > failing — and the console was a blank page.**
 *
 * A circular import. **A module cycle is a property of the IMPORT GRAPH rather
 * than of any file**, so no instrument that reads a file can see it. Thirty-three
 * assertions that read screen source all passed, correctly: every file was fine
 * and the composition was broken.
 *
 * ===========================================================================
 * WHAT IT HAS CAUGHT IN THIS PACKAGE
 * ===========================================================================
 *
 *   · **Pressing "Create customer" on an empty form did nothing at all.**
 *     `onInvalid` read `formState.errors` from a closure that was empty at that
 *     moment. It typechecked and it built. Clicking the button is what found it.
 *   · **A dead header link.** The wordmark was still `href="#/customers"` after
 *     the switch to path routing — and 57 checks passed anyway, because none of
 *     them clicked the logo. That is now a general assertion rather than a
 *     specific one: **no anchor anywhere may carry a hash route.**
 *   · **A check of mine passing for the wrong reason** — it confirmed a fixture
 *     switch by matching text present either way. It counts options now.
 *
 * ===========================================================================
 * FOUR STATES. READ THE EXIT CODE, NOT THE LAST LINE.
 * ===========================================================================
 *
 *   0 passed · 1 failed · **2 NOT RUN — no browser, nothing verified**
 *
 * `2` is neither a pass nor a skip. See `lib/browser-harness.mjs`.
 */

import { withBrowser, createReporter } from './lib/browser-harness.mjs';

const PACKAGE_DIRECTORY = new URL('..', import.meta.url).pathname;

const exitCode = await withBrowser({ packageDirectory: PACKAGE_DIRECTORY, port: 5199 }, async (page) => {
  const report = createReporter();
  const { note, section } = report;

  section('1. Cold load: the shell mounts and the auth gate shows the login');
  await page.goto('/', 2600);
  note('React mounted', (await page.evaluate('document.getElementById("root").children.length')) > 0);
  let body = await page.text();
  note('the shell rendered', body.includes('skip to main content'));
  note('the transport badge tells the truth', body.includes('fixture data'));
  note('the login screen is what an anonymous visitor gets', body.includes('sign in to dudo'));

  section('2. Signed in: the shared @dudo/ui primitives render');
  await page.evaluate('sessionStorage.setItem("dudo.session.hint","active")');
  await page.goto('/', 2800);
  body = await page.text();
  note('the directory heading renders', body.includes('customers'));
  note('the search box is present', await page.evaluate('!!document.getElementById("directory-search")'));
  const rows = await page.evaluate('document.querySelectorAll(".data-table tbody tr").length');
  note('DataTable rendered rows through @dudo/ui table.tsx', rows > 0, `rows: ${String(rows)}`);
  note(
    'cells carry the role-based placement the shared stylesheet keys off',
    await page.evaluate('!!document.querySelector(".data-table td[data-placement=\\"primary\\"]")'),
  );
  note(
    'the status tabs are a pressed-state group, not a tablist',
    await page.evaluate('!!document.querySelector("[role=\\"group\\"][aria-label=\\"Filter by status\\"]")'),
  );
  note(
    'the default directory writes NO status into the URL',
    !(await page.url()).includes('status='),
    `url: ${await page.url()}`,
  );

  section('3. Typed search params drive the read');
  await page.goto('/customers?status=archived', 2400);
  note('an archived filter is honoured', (await page.text()).includes('archived'), `url: ${await page.url()}`);
  await page.goto('/customers?status=banana', 2400);
  note('rubbish falls back rather than crashing', (await page.text()).includes('customers'));

  section('4. Navigation, and the form');
  await page.goto('/customers', 2400);
  const href = await page.evaluate(
    'document.querySelector(".data-table tbody a[href]")?.getAttribute("href") ?? ""',
  );
  note('a row links to its record', href.includes('/customers/'), `href: ${href}`);
  const recordId = href.split('/customers/')[1] ?? '';

  await page.goto(`/customers/${recordId}`, 2400);
  note('the record screen renders', (await page.text()).includes('customer identifier'));

  await page.goto('/customers/new', 2400);
  note(
    'React Hook Form registered the fields',
    (await page.evaluate('document.querySelectorAll("form input, form select, form textarea").length')) >= 6,
  );
  note(
    'the first field has focus and nothing stole it',
    (await page.evaluate('document.activeElement?.id')) === 'f-display_name',
  );
  note(
    'no untouched field is already showing an error',
    (await page.evaluate('document.querySelectorAll("form [aria-invalid=\\"true\\"]").length')) === 0,
  );

  /*
   * THE CHECK THAT CAUGHT THE SILENT BUTTON. Submitting an empty form must
   * refuse visibly. It did nothing at all, and `tsc` was satisfied.
   */
  await page.evaluate('document.querySelector("form button[type=submit]").click()');
  await page.sleep(900);
  body = await page.text();
  note('an empty submit is refused client-side', body.includes('before saving'));
  note(
    'the summary is an alert and takes focus',
    (await page.evaluate('document.activeElement?.getAttribute("role")')) === 'alert',
  );
  note(
    'the failing fields are marked beside themselves, not only in the summary',
    (await page.evaluate('document.querySelectorAll("form [aria-invalid=\\"true\\"]").length')) >= 2,
  );

  section('5. A mutation writes, invalidates, and the screen follows');
  await page.goto(`/customers/${recordId}`, 2400);
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Archive').click()`,
  );
  await page.sleep(600);
  note(
    'Archive asks before it acts, and focus moves to the confirming control',
    (await page.evaluate('document.activeElement?.textContent?.trim()')) === 'Yes, archive',
  );
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Yes, archive').click()`,
  );
  await page.sleep(1900);
  note('the record now reads archived', (await page.text()).includes('archived'));
  await page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Restore')?.click()`,
  );
  await page.sleep(1600);

  section('6. Responsive: the table becomes record cards on a phone');
  await page.emulate({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await page.goto('/customers', 2400);
  note(
    'the header row leaves the visual flow at phone width',
    (await page.evaluate('getComputedStyle(document.querySelector(".data-table thead")).position')) === 'absolute',
  );
  note(
    'each row becomes a card',
    (await page.evaluate('getComputedStyle(document.querySelector(".data-table tbody tr")).display')) === 'grid',
  );
  note(
    'the per-cell labels appear, because no header row carries them',
    (await page.evaluate('getComputedStyle(document.querySelector(".data-table .cell-label")).display')) !== 'none',
  );
  note(
    'nothing overflows the viewport horizontally',
    await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'),
  );
  await page.emulate({ width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  section('7. The KDF runs in a Worker, from @dudo/client-kdf');
  /*
   * A WORKER CHUNK EXISTING IN THE BUNDLE PROVES THE BUILD RESOLVED THE URL. It
   * proves nothing about the worker starting — and on silent failure the client
   * falls back to the main thread and reports `usedWorker: false`. The login
   * still works and nothing goes red. That is a degraded success, and it is the
   * shape to distrust after the KDF moved into a package reached by symlink.
   */
  await page.evaluate('sessionStorage.removeItem("dudo.session.hint")');
  await page.goto('/', 2400);
  await page.evaluate(`(() => {
    const set = (id, value) => {
      const el = document.getElementById(id);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('login-email', 'operator@example.com');
    set('login-password', 'correct horse battery staple');
  })()`);
  await page.sleep(400);
  await page.evaluate(`document.querySelector('form button[type=submit]').click()`);
  await page.sleep(6000);
  note('the 600,000-iteration derivation completed and the session opened', !(await page.text()).includes('sign in to dudo'));
  const workerFetches = await page.evaluate(
    `performance.getEntriesByType('resource').filter((e) => e.name.includes('kdf-worker')).length`,
  );
  note('the worker chunk was fetched — no silent main-thread fallback', workerFetches > 0, `entries: ${String(workerFetches)}`);

  section('8. Every in-app link goes somewhere');
  /*
   * THE GENERAL FORM OF A MISS. A dead `href="#/customers"` on the header
   * wordmark survived 57 checks because none clicked the logo.
   */
  for (const path of [`/customers/${recordId}`, '/customers']) {
    await page.goto(path, 2200);
    const hashLinks = await page.evaluate(
      `[...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => h.startsWith('#/') || h.includes('/#/'))`,
    );
    note(`no anchor on ${path} carries a hash route`, hashLinks.length === 0, `found: ${JSON.stringify(hashLinks)}`);
  }
  await page.goto(`/customers/${recordId}`, 2200);
  await page.evaluate(`document.querySelector('header a').click()`);
  await page.sleep(1600);
  note('the header wordmark returns to the directory', (await page.url()) === '/customers', `url: ${await page.url()}`);

  section('9. Nothing threw');
  const exceptions = page.exceptions.filter((e) => !/favicon/i.test(e));
  const errors = page.consoleErrors.filter((e) => !/favicon|React DevTools/i.test(e));
  note('no uncaught exception', exceptions.length === 0, exceptions.join('\n        '));
  note('no console error', errors.length === 0, errors.join('\n        '));

  return report.summarise();
});

process.exit(exitCode);
