/**
 * A zero-dependency browser harness: serve a built SPA, drive it over the
 * Chrome DevTools Protocol, report.
 *
 * ===========================================================================
 * WHY THIS IS IN THE REPOSITORY, AND IT WAS NOT UNTIL IT CAUGHT SOMETHING
 * ===========================================================================
 *
 * It lived in a session scratchpad, on the argument that Chrome is not an
 * approved dependency and a check that runs on one machine is not one anyone can
 * rely on. **That argument was correct while the harness had only confirmed
 * things other instruments could also see.**
 *
 * Then it caught this, in `platform/admin`:
 *
 * > **`tsc` 0, `vite build` 0, `npm run verify` 584 assertions passing and zero
 * > failing — and the console was a blank page.**
 *
 * A circular import. **A module cycle is legal TypeScript and legal ES, and it
 * is a property of the IMPORT GRAPH rather than of any file** — so no instrument
 * that inspects a file can see it, however good. The 33 assertions that read
 * screen source all passed, *correctly*: every file they read was fine. **The
 * composition was broken, and composition is not written down anywhere.**
 *
 * A second bug the same run found: `redirect()` thrown from a component body
 * throws where the router is not listening. **Legal, typed, silent.**
 *
 * ===========================================================================
 * FOUR STATES, AND THE EXIT CODE CARRIES THEM
 * ===========================================================================
 *
 * `workflow.md` §10: *passed, failed, skipped and NOT RUN are four states, and a
 * tool that cannot express the fourth is not reporting.*
 *
 *   **0** — ran, everything passed
 *   **1** — ran, something failed
 *   **2** — **NOT RUN.** No browser on this machine. **Nothing was verified.**
 *
 * **Exit 2 must never be read as success.** It is deliberately not `0`, so a
 * chain that folds this in cannot go green by not running it — and it is
 * deliberately not `1`, so a genuine failure stays distinguishable from an
 * absent browser.
 *
 * **It is NOT chained into `verify` in either package.** A gate that depends on
 * a browser being installed is a gate that reports on the machine rather than on
 * the code. It is run by name, and the day it can be relied on everywhere is the
 * day it joins — the same condition `check:source-bytes` was held to.
 *
 * ===========================================================================
 * NO NEW DEPENDENCY
 * ===========================================================================
 *
 * Node 22's global `fetch` and `WebSocket` speak the DevTools Protocol directly,
 * and the browser is whatever is already installed. **Nothing is added to any
 * `package.json` by this file**, which is what makes committing it free under
 * `security.md` §7.
 */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

/** Exit codes, named so a caller cannot mix up 1 and 2. */
export const RAN_AND_PASSED = 0;
export const RAN_AND_FAILED = 1;
export const NOT_RUN = 2;

/**
 * Where a browser might be. Checked in order; the first that exists is used.
 *
 * DELIBERATELY A LIST OF PATHS RATHER THAN A DOWNLOAD. A harness that installs a
 * browser to run itself has added a dependency by another route, and the
 * approval for that is the user's.
 */
const BROWSER_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findBrowser() {
  return BROWSER_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/**
 * Reports the fourth state and returns the exit code for it.
 *
 * IT IS LOUD ON PURPOSE. A quiet skip is read as a pass by whoever is scanning a
 * build log, and this check's whole value is that it sees what the others
 * cannot — so its absence has to be as visible as its failure.
 */
export function reportNotRun(reason) {
  console.log('');
  console.log('================================================================');
  console.log('  NOT RUN — no browser on this machine. NOTHING WAS VERIFIED.');
  console.log('================================================================');
  console.log(`  ${reason}`);
  console.log('');
  console.log('  THIS IS NOT A PASS AND NOT A SKIP. Every other check in this');
  console.log('  package inspects source or types. A module cycle, a redirect');
  console.log('  thrown where nothing listens, an unmounted tree — none of those');
  console.log('  is visible to any of them. This is the only instrument here that');
  console.log('  loads the page, and it did not load it.');
  console.log('');
  console.log('  Install a Chromium-based browser and re-run, or treat this');
  console.log('  package as UNVERIFIED at the level this check covers.');
  console.log('');
  return NOT_RUN;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(probe, attempts = 80, intervalMs = 250) {
  for (let index = 0; index < attempts; index += 1) {
    if (await probe()) return true;
    await sleep(intervalMs);
  }
  return false;
}

/**
 * Starts `vite preview` and a headless browser, hands back a driver, and tears
 * both down afterwards.
 *
 * THE BROWSER GETS ITS OWN `--user-data-dir` IN A TEMPORARY LOCATION, so it
 * never touches a real profile, and it is killed by that same argument rather
 * than by name — **killing by name on a developer machine would take down the
 * browser they are reading this in.**
 */
export async function withBrowser({ packageDirectory, port, debugPort = 9333 }, run) {
  const browser = findBrowser();
  if (browser === null) {
    return reportNotRun(
      `Looked for: ${BROWSER_CANDIDATES.join(', ')}`,
    );
  }

  const profile = `${process.env.TMPDIR ?? '/tmp'}dudo-smoke-${String(process.pid)}`;
  const origin = `http://127.0.0.1:${String(port)}`;

  const preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: packageDirectory,
    stdio: 'ignore',
  });
  const chrome = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${String(debugPort)}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const stop = () => {
    preview.kill();
    chrome.kill();
  };

  try {
    const previewUp = await waitFor(async () => {
      try {
        await fetch(origin);
        return true;
      } catch {
        return false;
      }
    });
    const browserUp = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${String(debugPort)}/json/version`);
        return response.ok;
      } catch {
        return false;
      }
    });

    if (!previewUp || !browserUp) {
      stop();
      return reportNotRun(
        `preview server ${previewUp ? 'started' : 'DID NOT START'} on ${origin}; ` +
          `browser ${browserUp ? 'started' : 'DID NOT START'} on port ${String(debugPort)}. ` +
          'A build must exist — run `npm run build` first.',
      );
    }

    const driver = await connect(debugPort, origin);
    const failures = await run(driver);
    driver.close();
    return failures === 0 ? RAN_AND_PASSED : RAN_AND_FAILED;
  } finally {
    stop();
  }
}

async function connect(debugPort, origin) {
  const created = await fetch(`http://127.0.0.1:${String(debugPort)}/json/new?about:blank`, {
    method: 'PUT',
  });
  const target = await created.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);

  const pending = new Map();
  const consoleErrors = [];
  const exceptions = [];
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(
        message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '),
      );
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(
        message.params.exceptionDetails.exception?.description ??
          message.params.exceptionDetails.text ??
          'unknown',
      );
    }
  });

  await new Promise((resolve) => socket.addEventListener('open', resolve));

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');

  /**
   * `innerText` RETURNS CSS-TRANSFORMED TEXT, and that cost two false failures
   * once: a badge authored "Fixture data" carries `uppercase`, so `innerText`
   * reports "FIXTURE DATA" and an assertion written against the SOURCE string
   * fails against a page rendering perfectly. Everything is lower-cased so the
   * comparison is about what is on the page rather than how it is styled.
   * `textContent` would sidestep the transform and also return `sr-only` text,
   * which makes the opposite mistake.
   */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation threw');
    }
    return result.result.value;
  };

  return {
    origin,
    evaluate,
    sleep,
    consoleErrors,
    exceptions,
    text: () => evaluate('document.body.innerText.replace(/\\s+/g," ").trim().toLowerCase()'),
    url: () => evaluate('location.pathname + location.search'),
    goto: async (path, settleMs = 2400) => {
      await send('Page.navigate', { url: `${origin}${path}` });
      await sleep(settleMs);
    },
    emulate: (metrics) => send('Emulation.setDeviceMetricsOverride', metrics),
    close: () => socket.close(),
  };
}

/** A reporter, so both harnesses count and print identically. */
export function createReporter() {
  const problems = [];
  return {
    note(label, ok, detail = '') {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n        ${detail}` : ''}`);
      if (!ok) problems.push(label);
    },
    section(title) {
      console.log(`\n=== ${title} ===\n`);
    },
    get failures() {
      return problems.length;
    },
    summarise() {
      console.log('');
      if (problems.length > 0) {
        console.log(`${String(problems.length)} check(s) FAILED: ${problems.join(' | ')}`);
      } else {
        console.log('All checks passed.');
      }
      return problems.length;
    },
  };
}
