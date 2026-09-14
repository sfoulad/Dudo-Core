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

  /* =======================================================================
     ⚠ EVERY OVERFLOW ASSERTION BELOW COMPARES AGAINST A LITERAL WIDTH, NOT
     AGAINST `window.innerWidth`, AND THE OLD FORM WAS VACUOUS
     =======================================================================

     `document.documentElement.scrollWidth <= window.innerWidth + 1` was the
     shape used at every viewport here, and it can never fail under mobile
     emulation. **When content overflows, the LAYOUT VIEWPORT EXPANDS TO FIT
     IT** — so `innerWidth` grows with `scrollWidth` and the two sides move
     together.

     Measured, on the real page, at a requested 390:

     ```
     mobile: true    innerWidth 421   scrollWidth 421   -> "clean", and 30px off-screen
     mobile: false   innerWidth 390   scrollWidth 420   -> the truth
     ```

     **The Team Lead's iframe reported 15px of overflow while this harness
     reported EXIT 0 with 77 assertions.** Two instruments, both measured, and
     the honest first move was to find which side moved rather than to decide.
     It was this one.

     Two repairs, and both are needed:

       · `mobile: false`, so the requested width is the width the page gets;
       · **the assertion names the width**, so it is a claim about the viewport
         that was asked for rather than about whatever the page grew into.

     And **every viewport is now read back from inside the page before it is
     trusted** — the lesson `docs/operations/browser-verification.md` records
     about `resize_window` returning success and changing nothing, which turns
     out to apply to this harness too, in a quieter form.
     ======================================================================= */

  section('6. Responsive: the table becomes record cards on a phone');
  await page.emulate({ width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
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
    'the viewport really is 390, read back from inside the page',
    (await page.evaluate('window.innerWidth')) === 390,
    `innerWidth: ${await page.evaluate('window.innerWidth')}`,
  );
  note(
    'nothing overflows the viewport horizontally',
    await page.evaluate('document.documentElement.scrollWidth <= 391'),
    `scrollWidth: ${await page.evaluate('document.documentElement.scrollWidth')}`,
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

  /* =======================================================================
     Milestone 2 — the /settings surface
     =======================================================================

     ⚠ **EVERYTHING BELOW IS THE FIRST TIME ANY OF IT HAS BEEN RENDERED.**
     Milestone 1's largest unclosed gap, stated in eight consecutive reports
     and closed in none, was that the entire client pass — six hundred Arabic
     strings, the `dir` switch, four surfaces of focus behaviour — was verified
     by reading source and by nothing else. **The focus return in particular
     was REASONED, never observed**, and the defect that prompted it was a
     focus restore that had never worked in panels an audit had already scored
     as correct.

     A source scan cannot see any of this. `tsc` cannot, the build cannot, and
     `verify:settings` cannot: it asserts that a `.focus()` call is PRESENT in
     the file. **Whether focus actually lands on the element is a property of
     the browser and of React's commit ordering**, and this is the only
     instrument in the repository that can answer it. */

  section('9. /settings renders, and its navigation comes from the registry');
  await page.emulate({ width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto('/settings', 2600);
  note('the settings index renders', (await page.text()).includes('organization settings'));
  note('and the address survived a deep link', (await page.url()) === '/settings');

  /*
   * ELEVEN, DERIVED FROM THE REGISTRY. A hardcoded expectation here would be a
   * second copy of the section list in a third file; the point of the number
   * is that the navigation renders one link per registry entry, so a section
   * added without a route — or a route added without a navigation entry —
   * moves it. `verify:settings` owns the identity comparison; this owns the
   * fact that they reached the DOM at all.
   */
  const navLinks = await page.evaluate('document.querySelectorAll(\'nav a[href^="/settings"]\').length');
  note('every section has a navigation link', navLinks >= 10, `links: ${String(navLinks)}`);

  const currentMarks = await page.evaluate('document.querySelectorAll(\'nav a[aria-current="page"]\').length');
  note('exactly one section is marked current', currentMarks === 1, `marked: ${String(currentMarks)}`);
  /*
   * ⚠ THE ASSERTION ABOVE PASSED WHILE THE MENU WAS BROKEN, AND THE REASON IS
   * WORTH MORE THAN THE ASSERTION.
   *
   * `/settings` is the one address in this section where a PREFIX match and an
   * EXACT match give the same answer — so a router marking every ancestor
   * current is invisible here and shows on all ten children. The count is
   * therefore re-taken on a child below, which is where it can actually fail.
   * `workflow.md` §11a: *the property that made the check pass belonged to the
   * input, not to the checker.*
   */

  note(
    'the header names Settings rather than Customers',
    (await page.evaluate('document.querySelector("header").innerText.toLowerCase()')).includes('settings'),
  );

  await page.goto('/settings/members', 2400);
  body = await page.text();
  note('a section that is not built says so', body.includes('not built yet'));
  note('and names what it is waiting on', body.includes('waiting on'));
  /*
   * THE ONE ASSERTION HERE THAT IS ABOUT HONESTY RATHER THAN ABOUT LAYOUT.
   * ADR 0010's audit removed demo data because *"an operator cannot tell it
   * from real"* — and the reader here is the customer. A table on an unbuilt
   * section would be fabricated members of somebody's actual company.
   */
  note(
    'and shows no fabricated data of any kind',
    (await page.evaluate('document.querySelectorAll("table, .data-table").length')) === 0,
  );
  const marksOnChild = await page.evaluate(
    'JSON.stringify([...document.querySelectorAll(\'nav a[aria-current="page"]\')].map((a) => a.getAttribute("href")))',
  );
  note(
    'exactly one section is marked current ON A CHILD ROUTE too',
    JSON.parse(marksOnChild).length === 1,
    `marked: ${marksOnChild}`,
  );
  note(
    'and it is the section the address names, not an ancestor',
    JSON.parse(marksOnChild)[0] === '/settings/members',
    `marked: ${marksOnChild}`,
  );

  section('10. The settings navigation collapses on a phone, and focus comes back');
  await page.emulate({ width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page.goto('/settings/members', 2400);

  const toggle = 'document.querySelector("button[aria-controls]")';
  note('a toggle appears at phone width', await page.evaluate(`!!${toggle}`));
  note(
    'the navigation starts collapsed',
    (await page.evaluate(`${toggle}.getAttribute("aria-expanded")`)) === 'false',
  );
  note(
    'and is genuinely not rendered, not merely transparent',
    (await page.evaluate('getComputedStyle(document.querySelector("nav")).display')) === 'none',
  );

  await page.evaluate(`${toggle}.click()`);
  await page.sleep(500);
  note(
    'pressing it expands the navigation',
    (await page.evaluate(`${toggle}.getAttribute("aria-expanded")`)) === 'true',
  );
  /*
   * FOCUS MOVED IN. Without this a keyboard reader presses the toggle and is
   * left standing where they were, with the new content announced nowhere.
   */
  note(
    'focus moves into the list rather than staying on the button',
    (await page.evaluate('document.activeElement.tagName')) === 'A',
    `active: ${await page.evaluate('document.activeElement.tagName + " " + (document.activeElement.getAttribute("href") ?? "")')}`,
  );

  await page.evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape"}))');
  await page.sleep(500);
  note(
    'Escape closes it',
    (await page.evaluate(`${toggle}.getAttribute("aria-expanded")`)) === 'false',
  );
  /*
   * ⚠ **AND THE RETURN IS ASSERTED SEPARATELY FROM THE CLOSE. THIS IS THE
   * ASSERTION THE WHOLE SECTION EXISTS FOR.**
   *
   * Closing and returning are two facts, and only the first is visible. A
   * panel that closes without returning focus drops the reader at the top of
   * the document silently — *"a line that does nothing is worse than a missing
   * line, because both the reader and the check stop looking."* Every previous
   * statement in this repository that a focus return works has been a reading
   * of the source. This one is a measurement.
   */
  note(
    'and focus RETURNS to the button that opened it',
    await page.evaluate(`document.activeElement === ${toggle}`),
    `active: ${await page.evaluate('document.activeElement.tagName + "." + document.activeElement.className.slice(0,40)')}`,
  );

  note(
    'the viewport really is 390, read back from inside the page',
    (await page.evaluate('window.innerWidth')) === 390,
    `innerWidth: ${await page.evaluate('window.innerWidth')}`,
  );
  note(
    'nothing overflows the viewport horizontally',
    await page.evaluate('document.documentElement.scrollWidth <= 391'),
    `scrollWidth: ${await page.evaluate('document.documentElement.scrollWidth')}`,
  );

  section('11. Arabic: the document flips and the copy changes');
  await page.emulate({ width: 1024, height: 768, deviceScaleFactor: 2, mobile: false });
  await page.goto('/settings', 2400);

  /*
   * THE NATIVE VALUE SETTER, because the `<select>` is React-controlled and a
   * plain assignment does not notify it — the same technique the login form
   * above needs, for the same reason.
   */
  await page.evaluate(`(() => {
    const el = document.querySelector('header select');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, 'ar');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(700);

  note(
    'the document direction becomes rtl',
    (await page.evaluate('document.documentElement.getAttribute("dir")')) === 'rtl',
  );
  note(
    'and lang becomes ar, which is what a screen reader picks its voice from',
    (await page.evaluate('document.documentElement.getAttribute("lang")')) === 'ar',
  );
  note(
    'the copy is actually Arabic, not merely right-aligned English',
    (await page.evaluate('document.body.innerText')).includes('إعدادات المؤسسة'),
  );

  /*
   * THE RAIL MOVES TO THE OTHER EDGE, MEASURED RATHER THAN ASSUMED. This is
   * the property the logical-property discipline exists to buy, and the only
   * proof that the grid really did mirror: `platform/admin` shipped a sidebar
   * that was invisible at every width while every source check passed.
   */
  const railOnEnd = await page.evaluate(`(() => {
    const nav = document.querySelector('nav');
    const main = document.getElementById('main');
    if (!nav || !main) return null;
    const n = nav.getBoundingClientRect(), m = main.getBoundingClientRect();
    return n.left + n.width / 2 > m.left + m.width / 2;
  })()`);
  note('the section rail moves to the inline-end edge under rtl', railOnEnd === true, `railOnEnd: ${JSON.stringify(railOnEnd)}`);

  note(
    'nothing overflows horizontally in rtl either',
    await page.evaluate('document.documentElement.scrollWidth <= 1025'),
    `innerWidth ${await page.evaluate('window.innerWidth')} · scrollWidth ${await page.evaluate('document.documentElement.scrollWidth')}`,
  );

  /*
   * AND BACK, so section 12's exception sweep is not reading a page left in a
   * state no other assertion covered.
   */
  await page.evaluate(`(() => {
    const el = document.querySelector('header select');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, 'en');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(500);
  note(
    'and switching back restores ltr',
    (await page.evaluate('document.documentElement.getAttribute("dir")')) === 'ltr',
  );

  /* =======================================================================
     iPad width, in Arabic — the intersection, which is where the bidi defect
     lived and where neither axis alone could find it
     ======================================================================= */

  section('12. 834 + Arabic: a wrapped LTR value aligns to its own direction');
  await page.emulate({ width: 834, height: 1112, deviceScaleFactor: 2, mobile: false });
  await page.evaluate(`(() => {
    const el = document.querySelector('header select');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, 'ar');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.goto('/settings/members', 2600);
  note('the viewport really is 834', await page.evaluate('window.innerWidth === 834'), `innerWidth: ${await page.evaluate('window.innerWidth')}`);
  note('and the document is rtl', (await page.evaluate('document.documentElement.getAttribute("dir")')) === 'rtl');

  /*
   * ⚠ THE ASSERTION THIS SECTION EXISTS FOR.
   *
   * A contract path is an LTR run inside an RTL paragraph. `<bdi>` isolates its
   * ORDER; it does nothing about the ALIGNMENT of its wrapped lines, because
   * alignment belongs to the block container. Measured before the fix: the two
   * lines shared a RIGHT edge at 64→494 and 392→494, so the reader's eye
   * returned to a start that was 300px of whitespace.
   *
   * **Neither axis alone reaches this.** At 1512 it does not wrap; in English
   * there is no RTL container. The case exists only in the intersection, which
   * is why this section sets both and why it is the last one added.
   */
  /*
   * ⚠ MEASURED AT 390, NOT AT 834, AND THE REASON IS THE FIX ITSELF.
   *
   * The defect was found at 834. **After the repair the value no longer wraps
   * there** — as a block it fills the `<dd>` instead of sharing a grid column,
   * so it has more room than it did. The first version of this assertion ran at
   * 834, got one line, and correctly reported NOT MEASURED rather than green.
   *
   * **The alignment property is width-independent**, so it is exercised at the
   * narrowest viewport this application supports, where the longest contract
   * path is guaranteed to wrap. 834 keeps the overflow and direction checks
   * above, which is where they belong.
   *
   * `/settings/profile` carries the longest path in the registry.
   */
  await page.emulate({ width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await page.goto('/settings/profile', 2400);
  const wrapped = await page.evaluate(`(() => {
    const el = document.querySelector('bdi[dir="ltr"]');
    if (!el) return { found: false };
    /*
     * ⚠ A RANGE, NOT THE ELEMENT. \`element.getClientRects()\` on a BLOCK returns
     * exactly ONE border-box rect however many lines it renders — so the first
     * version of this reader saw \`lines: 1\` at every width and could never have
     * measured the property. It reported NOT MEASURED rather than green, which
     * is the only reason the broken reader was found instead of shipped.
     * A Range over the contents returns one rect per LINE BOX, which is what
     * the question is about.
     */
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].map((r) => ({ left: Math.round(r.left), right: Math.round(r.right) }));
    if (rects.length < 2) return { found: true, lines: rects.length };
    const lefts = rects.map((r) => r.left);
    const rights = rects.map((r) => r.right);
    return {
      found: true,
      lines: rects.length,
      leftSpread: Math.max(...lefts) - Math.min(...lefts),
      rightSpread: Math.max(...rights) - Math.min(...rights),
    };
  })()`);
  note('the technical value is on the page to measure', wrapped.found === true, JSON.stringify(wrapped));
  if (wrapped.found && wrapped.lines > 1) {
    note(
      'its wrapped lines share a LEFT edge, not a right one',
      wrapped.leftSpread <= 2,
      `lines ${String(wrapped.lines)} · leftSpread ${String(wrapped.leftSpread)} · rightSpread ${String(wrapped.rightSpread)}`,
    );
  } else {
    /*
     * NOT A PASS. If the value stopped wrapping at this width the assertion
     * above examined nothing, and reporting that as green is the empty-list
     * reader — `workflow.md` §11a. It is announced so the next reader knows the
     * property is unmeasured rather than satisfied.
     */
    note(
      'NOT MEASURED: the value did not wrap, so alignment was not exercised',
      false,
      `lines: ${String(wrapped.lines)} — narrow the viewport or lengthen the value`,
    );
  }
  note(
    'nothing overflows at 390 in rtl either',
    await page.evaluate('document.documentElement.scrollWidth <= 391'),
    `innerWidth ${await page.evaluate('window.innerWidth')} · scrollWidth ${await page.evaluate('document.documentElement.scrollWidth')}`,
  );
  await page.emulate({ width: 834, height: 1112, deviceScaleFactor: 2, mobile: false });
  await page.goto('/settings/members', 2400);
  note(
    'nothing overflows at 834 in rtl',
    await page.evaluate('document.documentElement.scrollWidth <= 835'),
    `innerWidth ${await page.evaluate('window.innerWidth')} · scrollWidth ${await page.evaluate('document.documentElement.scrollWidth')}`,
  );

  section('13. No untranslated Latin prose survives into the Arabic render');
  /*
   * ⚠ THE POPULATION EVERY SOURCE SCAN IS BLIND TO.
   *
   * `platform/admin` shipped `— optional` on two Arabic field labels. It is
   * **composed at render time from a prop** inside a shared component, so it
   * exists only in the DOM: no scan of `.tsx` prose could reach it, and the
   * pins that reported zero were honest about a population that never
   * contained it.
   *
   * This walks the rendered text nodes instead. **Three exclusions, each
   * enumerated rather than defaulted** (`workflow.md` §11a — a skip-set must be
   * a list, not a fallback):
   *
   *   [dir="ltr"]   a technical value — a contract path, a request id
   *   select/option  each language is named in its OWN language, by design
   *   Dudo           the product's name, which is not a word
   */
  const latin = await page.evaluate(`(() => {
    const ALLOWED = ['Dudo'];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const found = [];
    let examined = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest('[dir="ltr"], select, option, script, style')) continue;
      if (!parent.offsetParent && parent.tagName !== 'BODY') continue;
      examined += 1;
      for (const run of (node.textContent || '').match(/[A-Za-z][A-Za-z'\\-]{2,}/g) || []) {
        if (!ALLOWED.includes(run)) found.push(run);
      }
    }
    return { examined, found: [...new Set(found)] };
  })()`);
  /*
   * A FLOOR ON THE WALKER. A TreeWalker that reaches nothing finds no Latin and
   * reports the page clean — the most confident wrong answer this check could
   * give, and the exact shape that let `optional` ship.
   */
  note('the DOM walker examined a plausible number of text nodes', latin.examined >= 20, `examined: ${String(latin.examined)}`);
  note('no untranslated Latin prose in the Arabic render', latin.found.length === 0, `found: ${JSON.stringify(latin.found)}`);

  await page.evaluate(`(() => {
    const el = document.querySelector('header select');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, 'en');
    el.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await page.sleep(500);
  await page.emulate({ width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  /* =======================================================================
     14. Every route has exactly one h1
     =======================================================================

     ⚠ TWO ROUTES HAD NO HEADING AT ALL AND NOTHING COULD SEE IT.

     `@dudo/ui`'s `StateBlock` rendered its title as `<p class="text-lg
     font-semibold">` — **a heading to every human reader and to no assistive
     technology.** `/nonexistent` and `/settings/no-such-section` therefore had
     ZERO headings, while `/customers` and `/settings` had an `h1`.

     **No static check could reach it and no screenshot could show it.** The
     styling is correct, the text is correct, the component is shared and
     correct-looking; the defect is in the ELEMENT, which exists only in the
     rendered DOM. It was found by reading that DOM.

     ⚠ AND THE SECOND HALF WAS FOUND ONLY BY MEASURING THE FIX. The settings
     shell does NOT supply the `h1` — the SECTION screen does — so the settings
     404, which replaces the section, was still left with an `h2` and no `h1`
     after the first repair. **A skipped level is what a partial fix looks
     like**, which is why this asserts the COUNT rather than mere presence.
     ======================================================================= */
  section('14. Heading structure: exactly one h1 per route');
  for (const path of [
    '/customers',
    '/customers/new',
    '/settings',
    '/settings/members',
    '/settings/no-such-section',
    '/nonexistent',
  ]) {
    await page.goto(path, 2200);
    const levels = JSON.parse(
      await page.evaluate(
        'JSON.stringify([...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => h.tagName))',
      ),
    );
    note(
      `${path} has exactly one h1`,
      levels.filter((tag) => tag === 'H1').length === 1,
      `headings: ${JSON.stringify(levels)}`,
    );
  }

  section('15. Nothing threw');
  const exceptions = page.exceptions.filter((e) => !/favicon/i.test(e));
  const errors = page.consoleErrors.filter((e) => !/favicon|React DevTools/i.test(e));
  note('no uncaught exception', exceptions.length === 0, exceptions.join('\n        '));
  note('no console error', errors.length === 0, errors.join('\n        '));

  return report.summarise();
});

process.exit(exitCode);
