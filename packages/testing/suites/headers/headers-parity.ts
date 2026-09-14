/**
 * ===========================================================================================
 * TWO `_headers` FILES IN TWO PACKAGES THAT MUST OTHERWISE AGREE.
 * ===========================================================================================
 *
 * `platform/web/public/_headers` and `platform/admin/public/_headers` carry the security
 * headers for the two consoles. **That is the divergence class `0040` spent a day ending**, one
 * layer below the code: two files, no import between them, and nothing that goes red when one
 * moves and the other does not.
 *
 * Per `architecture.md` §2a **a checker comparing two trees belongs to neither of them** — the
 * same reasoning that puts contract-set consistency in `packages/testing/**` and cross-boundary
 * comparisons in `scripts/**`. `web-agent` owns both files; this owns the relationship.
 *
 * ===========================================================================================
 * THE HASH IS NEVER TRANSCRIBED HERE, AND THAT IS A REQUIREMENT RATHER THAN TIDINESS
 * ===========================================================================================
 *
 * Web's `script-src` carries a `sha256-` hash for a pre-paint locale script. **It is not written
 * anywhere in this file and must never be.** `web-agent`'s `verify-settings.mjs` recomputes it
 * from `index.html` and asserts equality — that is the one place the value belongs.
 *
 * > **A hash quoted in a third place is the stale-copy class arriving inside the fix**, and it
 * > would rot in the direction nobody checks: a wrong hash here fails a test, a *stale* hash here
 * > that happens to match an old build passes one. **This file asserts the SHAPE of the hash and
 * > compares the two FILES to each other, never a value.**
 *
 * ===========================================================================================
 * THE TWO EXEMPTIONS ARE DECLARED, ARGUED, AND PINNED IN BOTH DIRECTIONS
 * ===========================================================================================
 *
 *   `script-src`     web carries a pre-paint locale script; admin's `index.html` has exactly one
 *                    `<script>`, `type="module" src="/src/main.tsx"` — VERIFIED by `web-agent`,
 *                    not assumed.
 *   `X-Robots-Tag`   admin only. **Not a security control** — a crawler directive is a request,
 *                    not an enforcement — it removes an unnecessary disclosure of the surface's
 *                    shape.
 *
 * **An exemption that stops being true goes RED rather than quietly persisting.** That is the
 * property that caught the Team Lead when the two suite entry points were wired in, and it is
 * why each exemption below is asserted to still be NEEDED as well as still be PERMITTED.
 *
 * *** THE FORWARD HAZARD, PINNED INSIDE THE EXEMPTION BECAUSE NOTHING ELSE WILL RAISE IT. ***
 * The admin console has **the same language switch and the same LTR-flash hazard**. If a
 * pre-paint script is ever added there, admin's `script-src` must gain a hash — and **nothing
 * will remind whoever adds it: CSP will simply block the script and the flash will return
 * looking like a styling problem.** So the `script-src` exemption asserts admin's value is
 * *exactly* `'self'`: the day it changes, this goes red and sends somebody to read this comment
 * rather than to debug a flash.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Suite } from '../../harness/runner.ts';
import { Suite as TestSuite, ISOLATION, assertEqual, assertTrue } from '../../harness/runner.ts';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const WEB = 'platform/web/public/_headers';
const ADMIN = 'platform/admin/public/_headers';

/** `Header-Name` -> value, per rule block. A `_headers` file is `path` then indented headers. */
export type HeaderFile = { readonly blocks: readonly string[]; readonly headers: Map<string, string> };

export function parseHeadersFile(text: string): HeaderFile {
  const blocks: string[] = [];
  const headers = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim().length === 0 || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      blocks.push(line.trim());
      continue;
    }
    const match = /^\s+([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
    if (match !== null) headers.set(match[1], match[2].trim());
  }
  return { blocks, headers };
}

/** A CSP value as `directive -> value`, so a difference names the directive rather than the string. */
export function parseCsp(value: string): Map<string, string> {
  const directives = new Map<string, string>();
  for (const part of value.split(';')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const space = trimmed.indexOf(' ');
    directives.set(
      space === -1 ? trimmed : trimmed.slice(0, space),
      space === -1 ? '' : trimmed.slice(space + 1).trim(),
    );
  }
  return directives;
}

const ADMIN_ONLY_HEADERS: readonly { readonly name: string; readonly because: string }[] = [
  {
    name: 'X-Robots-Tag',
    because:
      'Admin only, and NOT a security control — a crawler directive is a request rather than an ' +
      'enforcement. It removes an unnecessary disclosure of the surface\'s shape. Adding it to web ' +
      'would be wrong for a different reason: the application surface is meant to be reachable.',
  },
];

export function buildHeadersParitySuite(): Suite {
  const suite = new TestSuite('_headers — two files in two packages that must otherwise agree');

  suite.test('POPULATION — both files exist and parse to a non-trivial header set', () => {
    for (const path of [WEB, ADMIN]) {
      assertTrue(`${path} exists`, existsSync(REPO + path), `${path} is absent`);
    }
    const web = parseHeadersFile(readFileSync(REPO + WEB, 'utf8'));
    const admin = parseHeadersFile(readFileSync(REPO + ADMIN, 'utf8'));
    console.log(
      `      ${WEB}: ${String(web.headers.size)} header(s), block(s) ${web.blocks.join(' ')}\n` +
        `      ${ADMIN}: ${String(admin.headers.size)} header(s), block(s) ${admin.blocks.join(' ')}`,
    );
    // THE FLOOR. A parser that stops matching yields two empty maps, which compare EQUAL — the
    // most confident wrong answer a parity check can give. `§11a`'s empty-list reader with two
    // readers: they concur, and concurrence is the evidence being offered.
    assertTrue(
      'floor: the parser found headers in BOTH files',
      web.headers.size >= 5 && admin.headers.size >= 5,
      `parsed ${String(web.headers.size)} and ${String(admin.headers.size)} — two empty maps ` +
        'compare equal, so a broken parser reports perfect parity',
    );
    assertEqual('both declare exactly one rule block', `${web.blocks.join()}|${admin.blocks.join()}`, '/*|/*');
  });

  suite.test('the header NAME SETS agree, except the declared admin-only header', () => {
    const web = parseHeadersFile(readFileSync(REPO + WEB, 'utf8'));
    const admin = parseHeadersFile(readFileSync(REPO + ADMIN, 'utf8'));
    const exempt = new Set(ADMIN_ONLY_HEADERS.map((entry) => entry.name));

    const missingFromAdmin = [...web.headers.keys()].filter((name) => !admin.headers.has(name));
    const missingFromWeb = [...admin.headers.keys()].filter(
      (name) => !web.headers.has(name) && !exempt.has(name),
    );

    assertTrue(
      `${ISOLATION} every security header web declares, admin declares`,
      missingFromAdmin.length === 0,
      `${missingFromAdmin.join(', ')} is on ${WEB} and NOT on ${ADMIN}. The admin console is the ` +
        'platform-operator control centre; a header it is missing is a control the more sensitive ' +
        'surface lacks.',
    );
    assertTrue(
      `${ISOLATION} and every header admin declares, web declares — unless it is exempt`,
      missingFromWeb.length === 0,
      `${missingFromWeb.join(', ')} is on ${ADMIN} and NOT on ${WEB}, and is not on the enumerated ` +
        'exemption list. Add it to web, or declare the exemption with its reason.',
    );

    // THE EXEMPTION'S SECOND DIRECTION. An exemption that has stopped being needed must go red
    // rather than sit there permitting a divergence nobody is relying on any more.
    for (const entry of ADMIN_ONLY_HEADERS) {
      assertTrue(
        `the ${entry.name} exemption still describes the tree — admin declares it`,
        admin.headers.has(entry.name),
        `${entry.name} is exempted as admin-only and admin does NOT declare it. Remove the ` +
          'exemption, or restore the header.',
      );
      assertTrue(
        `the ${entry.name} exemption is still NEEDED — web does not declare it`,
        !web.headers.has(entry.name),
        `${entry.name} is exempted as admin-only and web declares it TOO. The divergence is gone, ` +
          'so the exemption is excusing nothing — remove it.',
      );
    }
  });

  suite.test('every shared header has an IDENTICAL value, except the CSP', () => {
    const web = parseHeadersFile(readFileSync(REPO + WEB, 'utf8'));
    const admin = parseHeadersFile(readFileSync(REPO + ADMIN, 'utf8'));
    const differences: string[] = [];
    let compared = 0;

    for (const [name, value] of web.headers) {
      if (name === 'Content-Security-Policy') continue; // compared directive-by-directive below
      const other = admin.headers.get(name);
      if (other === undefined) continue; // reported by the name-set case
      compared += 1;
      if (other !== value) differences.push(`${name}: web ${JSON.stringify(value)} vs admin ${JSON.stringify(other)}`);
    }

    console.log(`      compared ${String(compared)} shared header value(s) outside the CSP`);
    assertTrue(
      'floor: shared headers were actually compared',
      compared >= 4,
      `only ${String(compared)} shared headers were compared — a comparison over almost nothing ` +
        'reports parity it has not established',
    );
    assertTrue(
      `${ISOLATION} no shared header differs between the two consoles`,
      differences.length === 0,
      differences.join(' | '),
    );
  });

  suite.test('the CSP agrees DIRECTIVE BY DIRECTIVE, and script-src is the one declared exception', () => {
    const web = parseCsp(parseHeadersFile(readFileSync(REPO + WEB, 'utf8')).headers.get('Content-Security-Policy') ?? '');
    const admin = parseCsp(
      parseHeadersFile(readFileSync(REPO + ADMIN, 'utf8')).headers.get('Content-Security-Policy') ?? '',
    );

    assertTrue(
      'floor: both CSPs parsed into directives',
      web.size >= 5 && admin.size >= 5,
      `parsed ${String(web.size)} and ${String(admin.size)} directives — two empty maps agree`,
    );
    console.log(`      CSP directives: web ${String(web.size)}, admin ${String(admin.size)}`);

    const names = [...new Set([...web.keys(), ...admin.keys()])].sort();
    const differences = names
      .filter((name) => name !== 'script-src')
      .filter((name) => web.get(name) !== admin.get(name))
      .map((name) => `${name}: web ${JSON.stringify(web.get(name))} vs admin ${JSON.stringify(admin.get(name))}`);

    assertTrue(
      `${ISOLATION} every CSP directive except script-src is identical`,
      differences.length === 0,
      differences.join(' | ') +
        ' — comparing directive by directive rather than string by string means a reordering is ' +
        'not a failure and a real divergence names the directive.',
    );

    // ---- THE `script-src` EXEMPTION, ASSERTED ON SHAPE AND NEVER ON THE VALUE ----------------
    const webScript = web.get('script-src') ?? '';
    const adminScript = admin.get('script-src') ?? '';

    assertEqual(
      "admin's script-src is EXACTLY 'self' — see the forward hazard in this file's header",
      adminScript,
      "'self'",
    );
    assertTrue(
      "web's script-src is 'self' plus exactly one sha256 hash, and NOTHING else",
      /^'self' 'sha256-[A-Za-z0-9+/]{43}='$/.test(webScript),
      `web script-src is ${JSON.stringify(webScript)}. It must be 'self' and one base64 sha256 ` +
        'hash — the pre-paint locale script. THE VALUE IS NOT CHECKED HERE AND MUST NOT BE: ' +
        "`web-agent`'s verify-settings.mjs recomputes it from index.html, and a hash quoted in a " +
        'third place is a stale copy waiting to happen. This asserts the SHAPE.',
    );
    // And the exemption's other direction: if admin ever gains a hash, this case goes red and
    // sends the author to the forward-hazard note rather than leaving them to discover that CSP
    // silently blocked their script.
    assertTrue(
      'the script-src exemption is still NEEDED — the two values genuinely differ',
      webScript !== adminScript,
      'web and admin declare the same script-src, so the exemption excuses nothing. If admin ' +
        'gained a pre-paint script it must gain its own hash and this exemption must be rewritten ' +
        'to permit two DIFFERENT hashes rather than one hash and none.',
    );
  });

  suite.test('KNOWN-FAILING INPUTS — the parity logic, driven on constructed files', () => {
    // `§11a`: a check that has only ever passed is indistinguishable from one that examines
    // nothing. Every case above reads the real files; these drive the same parsers on input
    // shaped the way a real author would break it.
    const base = "/*\n  X-Frame-Options: SAMEORIGIN\n  Referrer-Policy: no-referrer\n";

    const parsed = parseHeadersFile(base);
    assertEqual('control: a well-formed file parses', parsed.headers.size, 2);
    assertEqual('and its block is read', parsed.blocks.join(), '/*');

    // A comment and a blank line are not headers.
    assertEqual(
      'comments and blank lines are ignored',
      parseHeadersFile("# a comment\n\n/*\n  X-Frame-Options: SAMEORIGIN\n").headers.size,
      1,
    );

    // A value containing a colon survives — `Strict-Transport-Security: max-age=86400` is fine,
    // but a CSP contains `https://` in some deployments and splitting on every colon would eat it.
    assertEqual(
      'a value containing a colon is not truncated',
      parseHeadersFile("/*\n  Content-Security-Policy: default-src 'none'; img-src https://x\n").headers.get(
        'Content-Security-Policy',
      ),
      "default-src 'none'; img-src https://x",
    );

    // The CSP splitter.
    const csp = parseCsp("default-src 'none'; script-src 'self' 'sha256-AAA='; object-src 'none'");
    assertEqual('a CSP splits into directives', csp.size, 3);
    assertEqual('and a multi-value directive keeps its values', csp.get('script-src'), "'self' 'sha256-AAA='");
    assertEqual("a valueless directive is read as empty rather than dropped", parseCsp('upgrade-insecure-requests').size, 1);

    // The hash-shape predicate, both ways.
    const shape = /^'self' 'sha256-[A-Za-z0-9+/]{43}='$/;
    const wellFormed = "'self' 'sha256-" + 'A'.repeat(43) + "='";
    assertTrue('a well-formed script-src matches', shape.test(wellFormed), wellFormed);
    assertTrue("a bare 'self' does NOT match", !shape.test("'self'"), 'a bare self was accepted');
    assertTrue(
      "'unsafe-inline' smuggled in does NOT match",
      !shape.test("'self' 'unsafe-inline' 'sha256-" + 'A'.repeat(43) + "='"),
      "'unsafe-inline' beside a hash was accepted — browsers IGNORE the hash when unsafe-inline " +
        'is in the same directive, so that value reads stricter than it is',
    );
    assertTrue('a truncated hash does NOT match', !shape.test("'self' 'sha256-AAA='"), 'a short hash was accepted');
  });

  return suite;
}
