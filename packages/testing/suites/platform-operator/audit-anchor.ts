/**
 * ===========================================================================================
 * `encodeAuditAnchor` AND `decodeAuditAnchor` MUST AGREE ON THEIR SEPARATOR.
 * ===========================================================================================
 *
 * **THE MECHANICAL DETECTOR THAT WAS AVAILABLE AND UNBUILT.** `7254f4b` changed one side of that
 * pair and not the other: encode joined with a raw NUL byte, decode split on the literal
 * six-character string `\u0000`. Page 1 worked, page 2 was unreachable on both feeds, `typecheck`
 * was exit 0, and every suite was green. It was caught by a human asking for page 2.
 *
 * ===========================================================================================
 * *** THE CASE THE TEAM LEAD ASKED FOR CANNOT BE WRITTEN, AND THIS IS THE NEXT BEST THING. ***
 * ===========================================================================================
 *
 * The brief was `decodeAuditAnchor(encodeAuditAnchor(record))` — one assertion, no dispatcher, no
 * fixture, no mock. **Both functions are module-private** (`platform-route-handlers.ts:872` and
 * `:876`; that module has exactly one export), so a test cannot call either. Reported to the Team
 * Lead with the two-word change that would make the briefed version possible; this file is what
 * is buildable without touching `platform/core/**`.
 *
 * IT READS THE TWO FUNCTIONS' SOURCE AND COMPARES THE SEPARATOR EACH SIDE USES, BY CHARACTER
 * CODE. That is a narrower claim than a behavioural round trip — it cannot catch a logic error
 * elsewhere in the pair — but it catches **exactly the defect that occurred**, it names the
 * invariant rather than exercising a path that happens to depend on it, and it fails the next
 * time anyone edits either side.
 *
 * ===========================================================================================
 * WHY COMPARING BY CHARACTER CODE IS THE WHOLE POINT, AND NOT PEDANTRY
 * ===========================================================================================
 *
 * The two sides are written in **two different notations for the same character**: encode embeds
 * a raw byte inside a template literal, decode calls `String.fromCharCode(0)`. Both are correct
 * and they are not comparable by eye — which is precisely why a diff reader missed the change.
 * The Team Lead re-verified the repair by character code *"since reading a diff is what failed
 * last time"*. **That was a one-off manual check; this makes it permanent.**
 *
 * A RAW CONTROL BYTE IS ALSO INVISIBLE IN MOST TOOLS. `platform-route-handlers.ts` contains four
 * of them, `file(1)` classifies it as `data`, and plain `grep` finds nothing in it without `-a`.
 * A check that depended on reading that file with ordinary tooling would be defeated by the same
 * property that hid the defect, so this one reads bytes.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';

const HANDLERS = fileURLToPath(
  new URL('../../../../platform/core/platform/platform-route-handlers.ts', import.meta.url),
);

/**
 * The separator `encodeAuditAnchor` emits, as a character code.
 *
 * It is the literal text between the two interpolations in the function's template literal, so
 * whatever byte sits there is what a cursor will carry — including a byte no editor renders.
 */
export function encodeSeparator(source: string): number[] | null {
  const body = /function encodeAuditAnchor\([^)]*\)[^{]*\{\s*return `([\s\S]*?)`;/.exec(source);
  if (body === null) {
    return null;
  }
  const between = /\$\{record\.occurredAt\}([\s\S]*?)\$\{record\.actionRecordId\}/.exec(body[1]!);
  if (between === null) {
    return null;
  }
  return [...between[1]!].map((character) => character.charCodeAt(0));
}

/**
 * The separator `decodeAuditAnchor` splits on, as a character code.
 *
 * TWO NOTATIONS ARE UNDERSTOOD AND BOTH HAVE BEEN IN THE FILE: `String.fromCharCode(N)`, which is
 * what it uses today, and a quoted string literal, which is what it used before `7254f4b` and
 * during it. A third notation returns `null` and the floor below turns that into a loud failure
 * rather than a silent pass — a reader that stops understanding one side is a reader that would
 * report agreement between one value and nothing.
 */
export function decodeSeparator(source: string): number[] | null {
  const body = /function decodeAuditAnchor\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source);
  if (body === null) {
    return null;
  }
  const fromCharCode = /\.split\(String\.fromCharCode\((\d+)\)\)/.exec(body[1]!);
  if (fromCharCode !== null) {
    return [Number(fromCharCode[1])];
  }
  const literal = /\.split\('([\s\S]*?)'\)/.exec(body[1]!);
  if (literal !== null) {
    // A quoted literal is taken as WRITTEN, not as JavaScript would parse it — `'\u0000'` in
    // source is six characters here, which is exactly the value `7254f4b` split on and exactly
    // the disagreement this check exists to find.
    return [...literal[1]!].map((character) => character.charCodeAt(0));
  }
  return null;
}

export function buildAuditAnchorSuite(): Suite {
  const suite = new Suite('Audit feeds — encode and decode agree on the anchor separator');

  suite.test('the reader understood BOTH sides — the floor for the comparison below', () => {
    // WITHOUT THIS THE COMPARISON IS UNREADABLE. A regex that stopped matching would return
    // `null` on both sides, and `null === null` is agreement. That is the shape of a check that
    // has quietly stopped checking, and it is the one this file is most at risk of.
    const source = readFileSync(HANDLERS, 'utf8');
    const encode = encodeSeparator(source);
    const decode = decodeSeparator(source);
    assertTrue(
      'the encode side was located and its separator extracted',
      encode !== null,
      'encodeAuditAnchor was not found, or its template literal no longer has the expected shape. ' +
        'This check is now reading nothing; fix the reader rather than deleting the case.',
    );
    assertTrue(
      'the decode side was located and its separator extracted',
      decode !== null,
      'decodeAuditAnchor was not found, or it splits on a notation this reader does not ' +
        'understand. Add the notation; a reader that shrugs is a check that passes.',
    );
    assertTrue(
      'and each is exactly one character',
      encode!.length === 1 && decode!.length === 1,
      `encode=${JSON.stringify(encode)} decode=${JSON.stringify(decode)} — a multi-character ` +
        'separator is not wrong in itself, but it is a change this case should force someone to ' +
        'argue rather than absorb',
    );
  });

  suite.test('THE INVARIANT: the byte encode writes is the byte decode splits on', () => {
    const source = readFileSync(HANDLERS, 'utf8');
    const encode = encodeSeparator(source)!;
    const decode = decodeSeparator(source)!;
    assertEqual(
      `${ISOLATION} the two sides of the anchor pair use the same separator`,
      `encode=${JSON.stringify(encode)}`,
      `encode=${JSON.stringify(decode)}`,
    );
    // AND IT IS THE ONE THE COMMENT CLAIMS. `encodeAuditAnchor`'s header says the separator
    // "cannot appear in either component" because `occurred_at` is RFC 3339 and
    // `action_record_id` matches the identifier grammar. That argument holds for NUL and not for,
    // say, a hyphen — so the specific value is part of the claim, not an implementation detail.
    assertEqual('and it is NUL, which neither component can contain', encode[0], 0);
  });

  suite.test(
    'THE CONSTRUCTED FAILING INPUT: a pair that disagrees is reported, and 7254f4b is the input',
    () => {
      // =====================================================================================
      // THE EXACT DEFECT, REBUILT AS TEXT AND FED TO THE READER.
      // =====================================================================================
      //
      // `7254f4b`'s diff was one line: `anchor.split('^@')` became `anchor.split('\u0000')` — a
      // raw byte replaced by a six-character escape sequence. Below, `encode` keeps the raw byte
      // and `decode` splits on the literal escape, which is that commit verbatim.
      //
      // A reader that reported these as agreeing would be the reader that let it through.
      const broken =
        'function encodeAuditAnchor(record: PlatformAuditRecord): string {\n' +
        '  return `${record.occurredAt}' +
        String.fromCharCode(0) +
        '${record.actionRecordId}`;\n' +
        '}\n' +
        '\n' +
        'function decodeAuditAnchor(anchor: string): PlatformAuditAnchor | null {\n' +
        "  const parts = anchor.split('\\u0000');\n" +
        '  return null;\n' +
        '}\n';

      const encode = encodeSeparator(broken);
      const decode = decodeSeparator(broken);
      assertTrue(
        'the reader parsed both sides of the broken pair',
        encode !== null && decode !== null,
        `encode=${JSON.stringify(encode)} decode=${JSON.stringify(decode)}`,
      );
      assertEqual('encode still emits the raw NUL', JSON.stringify(encode), JSON.stringify([0]));
      assertTrue(
        'and decode splits on something else entirely',
        JSON.stringify(decode) !== JSON.stringify([0]),
        'the reader read the six-character escape as a NUL, so it cannot tell the two notations ' +
          'apart and would have reported 7254f4b as agreeing',
      );
      assertTrue(
        `${ISOLATION} so the comparison REPORTS the disagreement`,
        JSON.stringify(encode) !== JSON.stringify(decode),
        'the check reports agreement on the pair that broke both audit feeds',
      );

      // AND THE MIRROR: a pair that agrees in a DIFFERENT notation is not reported. Without this
      // the check could be passing by rejecting everything.
      const agreeing = broken.replace("anchor.split('\\u0000')", 'anchor.split(String.fromCharCode(0))');
      assertEqual(
        'a pair written in two notations for the SAME byte is accepted',
        JSON.stringify(encodeSeparator(agreeing)),
        JSON.stringify(decodeSeparator(agreeing)),
      );
    },
  );

  return suite;
}
