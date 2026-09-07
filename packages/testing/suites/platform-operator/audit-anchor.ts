/**
 * ===========================================================================================
 * `encodeAuditAnchor` AND `decodeAuditAnchor` MUST AGREE. TWO CHECKS, FROM TWO DIRECTIONS.
 * ===========================================================================================
 *
 * **THE MECHANICAL DETECTOR THAT WAS AVAILABLE AND UNBUILT.** `7254f4b` changed one side of that
 * pair and not the other: encode joined with a raw NUL byte, decode split on a six-character
 * string. Page 1 worked, page 2 was unreachable on both feeds, `typecheck` was exit 0, and every
 * suite was green. It was caught by a human asking for page 2.
 *
 * **THE EXACT SPELLING MATTERS, AND THIS FILE HAD IT WRONG.** `7254f4b` wrote a split on a
 * DOUBLED backslash followed by `u0000`, which JavaScript reads as six characters — hence the
 * defect. A SINGLE backslash followed by `u0000` denotes one NUL and is perfectly correct code.
 * **The two differ by one byte in the source and by everything at runtime**, and until 2026-09-07
 * the source reader below could not tell them apart: it read the captured text AS WRITTEN, so it
 * called the correct spelling broken too. `unescapeSourceText` is the repair, and the six-case
 * table at the end of this file is the constructed evidence that it discriminates.
 *
 * The sentence this header carried until 2026-09-07 named the wrong spelling: it said `7254f4b`
 * split on `\u0000`, which is the SINGLE-backslash form and denotes one NUL — correct
 * code, not the defect. The commit's own diff is the source: it wrote the doubled form. **Getting
 * this wrong in prose is harmless; the reader below encoded the same confusion and was not.**
 *
 * ===========================================================================================
 * WHY BOTH CHECKS, AND WHY NEITHER SUBSUMES THE OTHER
 * ===========================================================================================
 *
 * **THE ROUND TRIP** — `decodeAuditAnchor(encodeAuditAnchor(record))` — is the real assertion and
 * became possible when `29b2f3e` exported both functions. It catches a behavioural disagreement
 * whatever its cause, including one the source does not reveal.
 *
 * **THE SOURCE READER** compares the separator each side is written with, by character code. It
 * catches a source edit **that never runs** — a notation change in a branch nobody exercised, a
 * second encode added beside the first — and it is the check that would have caught `7254f4b` at
 * the moment of the edit rather than at the moment somebody paged.
 *
 * Same pattern as the permission model's ceiling-and-floor pair, kept for the same reason.
 *
 * ===========================================================================================
 * *** THE READERS RUN OVER COMMENT-STRIPPED SOURCE, AND THAT IS STRUCTURAL RATHER THAN CAREFUL. ***
 * ===========================================================================================
 *
 * `1eb93b3` added a prohibition comment above `decodeAuditAnchor` containing the literal text
 * `decodeAuditAnchor(encodeAuditAnchor(record))`. Today's readers are unaffected because both
 * require a literal `function ` prefix — verified by running them, not by reasoning about them.
 *
 * **BUT "CORRECT BY A PREFIX" IS A THIN MARGIN FOR A CHECK WHOSE JOB IS TO NOTICE A ONE-BYTE
 * DISAGREEMENT.** A future reader that dropped the prefix would match the COMMENT, find a
 * separator, compare it against itself, and pass — **a check reading its own documentation and
 * agreeing with it.** That is the fourth costume today of "a checker that examines the wrong thing
 * and reports success."
 *
 * So the comments are removed before either reader runs. A regex that loses its prefix then has no
 * comment left to match, which closes the class rather than guarding one instance of it. The floor
 * below asserts the stripping actually happened, because a stripper that silently stopped working
 * would restore the hazard invisibly.
 *
 * ===========================================================================================
 * NO LINE NUMBERS ARE TRANSCRIBED IN THIS FILE, AND THE REASON IS THIS FILE'S OWN ARGUMENT
 * ===========================================================================================
 *
 * A previous version of this header cited the two declarations at `872` and `876`. **They were at
 * 873 and 877 when it was written** — off by one, never right rather than gone stale — and after
 * `1eb93b3` inserted a 24-line comment they were off by twenty-five. That is `architecture.md`
 * §3c's family: a citation is a claim about the thing cited, and a reader checking it would have
 * landed one line away and might well have shrugged.
 *
 * **A file arguing that eyes fail on this material has no business hand-copying line numbers.**
 * Where a location matters it is derived at runtime and printed; otherwise the function is named
 * and the reader can grep — with `-a`, since this file still holds raw control bytes.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';
import { stripComments } from '../../harness/source-text.ts';
import {
  decodeAuditAnchor,
  encodeAuditAnchor,
} from '../../../../platform/core/platform/platform-route-handlers.ts';
import type { PlatformAuditRecord } from '../../../../platform/core/platform/platform-operator-store.ts';

const HANDLERS_PATH = fileURLToPath(
  new URL('../../../../platform/core/platform/platform-route-handlers.ts', import.meta.url),
);

/** The comment text `1eb93b3` added, which a prefix-less reader would match. */
const PROHIBITION_TEXT = 'decodeAuditAnchor(encodeAuditAnchor(record))';

function handlersSource(): string {
  return readFileSync(HANDLERS_PATH, 'utf8');
}

/** The source both readers see: comments removed. See the header. */
function readableSource(): string {
  return stripComments(handlersSource(), 'ts');
}

/**
 * ===========================================================================================
 * *** THE ESCAPE RESOLVER, AND WHY READING SOURCE "AS WRITTEN" WAS A FALSE-POSITIVE MACHINE. ***
 * ===========================================================================================
 *
 * Both readers capture a run of SOURCE TEXT and must answer what STRING that text denotes. Until
 * 2026-09-07 they answered by taking the characters literally, which is right for a raw byte and
 * **wrong for every escape** — so a correct single-backslash escape was reported as six characters
 * disagreeing with a one-character encode.
 *
 * **THAT IS A CHECK THAT MANUFACTURES A DEFECT, WHICH IS THE HARDER DIRECTION TO CATCH.** A check
 * finding nothing is at least suspicious. A check finding something feels like it is working, and
 * nobody re-derives a red — so it would have been believed, and the natural way to make it green
 * again is to change the code it is pointing at.
 *
 * **IT WAS ABOUT TO SPEAK.** `platform-route-handlers.ts` holds three raw NUL bytes, `file(1)`
 * therefore classifies it as `data`, and plain `grep` answers every search in it with silence and
 * exit 1 — indistinguishable from a clean result. The fix for that is to write the bytes as
 * escapes, and **the moment `encodeAuditAnchor` does so, three cases in this file go red on code
 * that is correct.** Found before it spoke, by probing the reader rather than by reading it.
 *
 * Returns `null` on an escape it does not understand, which the floor turns into a loud failure.
 * **A resolver that silently passed an unknown escape through would restore the original defect
 * in a new costume** — an unrecognised notation compared against a recognised one.
 */
export function unescapeSourceText(text: string): number[] | null {
  const codes: number[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character !== '\\') {
      codes.push(character.charCodeAt(0));
      index += 1;
      continue;
    }
    const next = text[index + 1];
    if (next === undefined) {
      return null;
    }
    const simple: Record<string, number> = {
      '0': 0,
      n: 10,
      r: 13,
      t: 9,
      b: 8,
      f: 12,
      v: 11,
      '\\': 92,
      "'": 39,
      '"': 34,
      '`': 96,
    };
    if (next === 'u' || next === 'x') {
      const width = next === 'u' ? 4 : 2;
      const digits = text.slice(index + 2, index + 2 + width);
      if (!new RegExp(`^[0-9a-fA-F]{${String(width)}}$`).test(digits)) {
        // `\u{1F600}` and a truncated escape both land here. Neither is understood, and an
        // unknown escape is reported rather than guessed at.
        return null;
      }
      codes.push(Number.parseInt(digits, 16));
      index += 2 + width;
      continue;
    }
    if (Object.hasOwn(simple, next)) {
      codes.push(simple[next]!);
      index += 2;
      continue;
    }
    return null;
  }
  return codes;
}

/**
 * The separator `encodeAuditAnchor` emits, as character codes.
 *
 * It is the text between the two interpolations in the function's template literal, resolved
 * through `unescapeSourceText`, so a raw byte and its escape are the same answer — which is what
 * a cursor will actually carry.
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
  return unescapeSourceText(between[1]!);
}

/**
 * The separator `decodeAuditAnchor` splits on, as character codes.
 *
 * TWO NOTATIONS ARE UNDERSTOOD AND BOTH HAVE BEEN IN THE FILE: `String.fromCharCode(N)`, which is
 * what it uses today, and a quoted string literal, which is what it used before `7254f4b` and
 * during it. A third notation returns `null`, and the floor turns that into a loud failure rather
 * than a silent pass — a reader that stops understanding one side would otherwise report agreement
 * between one value and nothing.
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
    // RESOLVED THE WAY JAVASCRIPT WOULD RESOLVE IT, which is the whole point: a single-backslash
    // escape denotes one NUL and must AGREE with a raw-byte encode, while the doubled backslash
    // `7254f4b` actually wrote denotes six characters and must DISAGREE. Reading the text as
    // written cannot tell those apart and called both of them broken.
    return unescapeSourceText(literal[1]!);
  }
  return null;
}

// The reader this replaced took the captured text literally, so it read the escape
// `\u0000` as six characters rather than as the one NUL it denotes.

function record(overrides: Partial<PlatformAuditRecord> = {}): PlatformAuditRecord {
  return {
    actionRecordId: 'par_0000000000001',
    occurredAt: '2026-09-04T12:00:00.000Z',
    actorPrincipalId: 'prn_platform_admin01',
    actorPlatformRole: 'platform-admin',
    actionId: 'platform.audit.list',
    outcome: 'ok',
    correlationId: 'corr_platform_00001',
    targetOrganizationId: null,
    targetPrincipalId: null,
    ...overrides,
  };
}

export function buildAuditAnchorSuite(): Suite {
  const suite = new Suite('Audit feeds — the anchor pair agrees, checked two ways');

  // =========================================================================================
  // DIRECTION ONE: THE ROUND TRIP. The assertion the whole thing is about.
  // =========================================================================================

  suite.test('THE ROUND TRIP: decode(encode(record)) returns the record\'s two fields', () => {
    const source = record();
    const decoded = decodeAuditAnchor(encodeAuditAnchor(source));
    assertTrue(
      `${ISOLATION} the encoded anchor decodes at all`,
      decoded !== null,
      'encode produced a string decode rejects. This is 7254f4b exactly: page 1 works, page 2 is ' +
        'unreachable on both feeds, and nothing else in the repository notices',
    );
    assertEqual('the occurred_at survives', decoded!.occurredAt, source.occurredAt);
    assertEqual('and the record id survives', decoded!.actionRecordId, source.actionRecordId);
  });

  suite.test('the round trip holds for the values the feeds actually produce', () => {
    // ONE RECORD IS ONE SHAPE. `occurred_at` is RFC 3339 with three fractional digits since
    // `7686940`, and `action_record_id` matches the platform identifier grammar — the two facts
    // the separator's safety argument rests on. These are the boundaries of both.
    for (const [label, entry] of [
      ['a millisecond-precision instant', record({ occurredAt: '2026-12-31T23:59:59.999Z' })],
      ['the epoch-ish start of the range', record({ occurredAt: '2000-01-01T00:00:00.000Z' })],
      ['the shortest legal identifier', record({ actionRecordId: 'a'.repeat(8) })],
      ['the longest legal identifier', record({ actionRecordId: 'z'.repeat(64) })],
      ['an identifier of hyphens and underscores', record({ actionRecordId: 'a-b_c-d_e-f_0-1' })],
    ] as const) {
      const decoded = decodeAuditAnchor(encodeAuditAnchor(entry));
      assertTrue(`${label}: it decodes`, decoded !== null, `encode/decode disagreed on ${label}`);
      assertEqual(`${label}: occurred_at`, decoded!.occurredAt, entry.occurredAt);
      assertEqual(`${label}: record id`, decoded!.actionRecordId, entry.actionRecordId);
    }
  });

  suite.test(
    'THE CONSTRUCTED FAILING INPUT: an anchor joined with any other separator does NOT decode',
    () => {
      // =====================================================================================
      // WITHOUT THIS, THE ROUND TRIP COULD PASS ON A DECODER THAT ACCEPTS ANYTHING.
      // =====================================================================================
      //
      // A `decodeAuditAnchor` that split on, say, `T` would still round-trip a value its own
      // encode produced — and would silently mis-parse every real anchor. So the separator is
      // shown to be load-bearing: the same two fields joined by anything else must be rejected.
      const entry = record();
      for (const [label, separator] of [
        ['the literal six-character escape — 7254f4b itself', '\\u0000'],
        ['a hyphen', '-'],
        ['a space', ' '],
        ['nothing at all', ''],
      ] as const) {
        const forged = `${entry.occurredAt}${separator}${entry.actionRecordId}`;
        assertTrue(
          `${ISOLATION} an anchor joined with ${label} is refused`,
          decodeAuditAnchor(forged) === null,
          `decode accepted an anchor built with ${label}, so the separator is not what it is ` +
            'splitting on and the round trip above proves nothing about agreement',
        );
      }
      // AND THE MIRROR: the real separator IS accepted, so the four refusals are about the
      // separator rather than about decode rejecting everything.
      assertTrue(
        'the real separator still decodes',
        decodeAuditAnchor(encodeAuditAnchor(entry)) !== null,
        'decode refuses its own encode output',
      );
    },
  );

  // =========================================================================================
  // DIRECTION TWO: THE SOURCE READER. Catches an edit that never runs.
  // =========================================================================================

  suite.test('the readers see code and NOT comments — the floor that closes the hazard', () => {
    // ===================================================================================
    // THE HAZARD, ASSERTED CLOSED RATHER THAN AVOIDED BY A PREFIX. See the header.
    // ===================================================================================
    const raw = handlersSource();
    const readable = readableSource();
    assertTrue(
      'the prohibition comment really is in the file, so this floor is not vacuous',
      raw.includes(PROHIBITION_TEXT),
      'the comment `1eb93b3` added is gone. If it was removed deliberately this floor should be ' +
        'removed with it; if not, the prohibition it carries has been lost',
    );
    assertTrue(
      `${ISOLATION} and it is NOT in what the readers see`,
      !readable.includes(PROHIBITION_TEXT),
      'the comment stripper left the prohibition text in place, so a reader that lost its ' +
        '`function ` prefix would match the comment, compare a separator against itself, and pass',
    );
    assertTrue(
      'the stripper did not simply eat the file',
      readable.includes('function encodeAuditAnchor') &&
        readable.includes('function decodeAuditAnchor'),
      'both declarations are gone from the stripped source, so the readers below are reading ' +
        'nothing and would agree about it',
    );
  });

  suite.test('the reader understood BOTH sides — the floor for the comparison below', () => {
    // A regex that stopped matching returns `null` on both sides, and `null === null` is
    // agreement. That is the shape of a check that has quietly stopped checking.
    const source = readableSource();
    const encode = encodeSeparator(source);
    const decode = decodeSeparator(source);
    assertTrue(
      'the encode side was located and its separator extracted',
      encode !== null,
      'encodeAuditAnchor was not found, or its template literal no longer has the expected ' +
        'shape. Fix the reader rather than deleting the case.',
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
      `encode=${JSON.stringify(encode)} decode=${JSON.stringify(decode)}`,
    );
  });

  suite.test('THE INVARIANT IN SOURCE: the byte encode writes is the byte decode splits on', () => {
    const source = readableSource();
    assertEqual(
      `${ISOLATION} the two sides of the anchor pair use the same separator`,
      `encode=${JSON.stringify(encodeSeparator(source))}`,
      `encode=${JSON.stringify(decodeSeparator(source))}`,
    );
    // AND IT IS THE ONE THE ARGUMENT DEPENDS ON. The separator is safe because it "cannot appear
    // in either component" — true of NUL, false of a hyphen — so the specific value is part of
    // the claim rather than an implementation detail.
    assertEqual('and it is NUL, which neither component can contain', encodeSeparator(source)![0], 0);
  });

  suite.test('THE READER\'S OWN FAILING INPUTS: six pairs, and it gets each one right', () => {
    // =====================================================================================
    // *** THE READER IS A CHECKER, SO IT NEEDS ITS OWN KNOWN-FAILING INPUTS. ***
    // =====================================================================================
    //
    // Before 2026-09-07 this case fed the reader ONE pair and asserted it was reported as
    // disagreeing — and the pair it fed was `.split('` + one backslash + `u0000')`, which
    // denotes ONE NUL and is CORRECT CODE. So the case asserted that the reader flags correct
    // code as broken, and it was green. **The instrument's false positive had been written down
    // as the expected behaviour**, which is the most durable way for one to survive.
    //
    // THE TWO SPELLINGS ARE BUILT FROM A CHARACTER CODE, NOT TYPED. They differ by a single
    // backslash, an editor may normalise one into the other, and the whole defect lives in that
    // difference — so neither is written as a literal anywhere in this file.
    const BACKSLASH = String.fromCharCode(92);
    const NUL = String.fromCharCode(0);
    const SINGLE = `'${BACKSLASH}u0000'`;
    const DOUBLED = `'${BACKSLASH}${BACKSLASH}u0000'`;

    const pair = (encodeBetween: string, decodeSplit: string): string =>
      'function encodeAuditAnchor(record: PlatformAuditRecord): string {\n' +
      '  return `${record.occurredAt}' +
      encodeBetween +
      '${record.actionRecordId}`;\n' +
      '}\n\n' +
      'function decodeAuditAnchor(anchor: string): PlatformAuditAnchor | null {\n' +
      `  const parts = anchor.split(${decodeSplit});\n` +
      '  return null;\n' +
      '}\n';

    // Each row states what is TRUE of the pair at runtime, independently of what the reader
    // says. `agree` means the two sides really would carry the same separator.
    const rows: Array<{ label: string; encode: string; decode: string; agree: boolean | 'floor' }> =
      [
        {
          label: 'raw byte / fromCharCode(0) — what the file holds today',
          encode: NUL,
          decode: 'String.fromCharCode(0)',
          agree: true,
        },
        {
          label: 'raw byte / SINGLE backslash escape — correct code, and the old false positive',
          encode: NUL,
          decode: SINGLE,
          agree: true,
        },
        {
          label: 'raw byte / DOUBLED backslash — 7254f4b verbatim, six characters, the defect',
          encode: NUL,
          decode: DOUBLED,
          agree: false,
        },
        {
          label: 'escaped encode / fromCharCode(0) — the NUL-removal fix, correct',
          encode: `${BACKSLASH}u0000`,
          decode: 'String.fromCharCode(0)',
          agree: true,
        },
        {
          label: 'a real space / fromCharCode(0) — a genuine disagreement',
          encode: ' ',
          decode: 'String.fromCharCode(0)',
          agree: false,
        },
        {
          label: 'raw byte / a notation the reader does not know',
          encode: NUL,
          decode: 'SEPARATOR',
          agree: 'floor',
        },
      ];

    for (const row of rows) {
      const source = pair(row.encode, row.decode);
      const encode = encodeSeparator(source);
      const decode = decodeSeparator(source);
      if (row.agree === 'floor') {
        // NOT "the reader disagrees" — `null` is the floor firing, and the two are different
        // outcomes. A reader that shrugged and returned a value would be compared against a
        // real one, which is the original defect wearing a new notation.
        assertTrue(
          `${ISOLATION} ${row.label}: reported as NOT UNDERSTOOD rather than as a value`,
          decode === null,
          `the reader returned ${JSON.stringify(decode)} for a notation it does not implement`,
        );
        continue;
      }
      assertTrue(
        `${row.label}: both sides were read at all`,
        encode !== null && decode !== null,
        `encode=${JSON.stringify(encode)} decode=${JSON.stringify(decode)} — a null here means ` +
          'the floor fired on a pair this case expects a verdict for',
      );
      assertEqual(
        `${ISOLATION} ${row.label}`,
        JSON.stringify(encode) === JSON.stringify(decode) ? 'agree' : 'disagree',
        row.agree ? 'agree' : 'disagree',
      );
      if (row.agree) {
        // AND THEY AGREE ON THE RIGHT BYTE. Two sides agreeing on a space would satisfy the
        // line above; the separator's safety argument is about NUL specifically.
        assertEqual(
          `${row.label}: and the byte they agree on is NUL`,
          JSON.stringify(encode),
          JSON.stringify([0]),
        );
      }
    }
  });

  // =========================================================================================
  // WHAT THE EXPORT COST, AND THE CHEAP HALF OF GUARDING IT
  // =========================================================================================

  suite.test('decodeAuditAnchor has exactly ONE caller in platform/core, and it is the feed', () => {
    // ===================================================================================
    // *** THE HAZARD THE EXPORT CREATED, STATED AND THEN BOUNDED — HONESTLY, INCLUDING WHAT
    // THIS DOES NOT PROVE. ***
    // ===================================================================================
    //
    // Before `29b2f3e`, `decodeAuditAnchor` was reachable only through `cursors.decode`, which
    // verifies the signature and the binding BEFORE the anchor is parsed. Exporting it means a
    // future author building a second feed could call it directly on a raw client string and skip
    // that verification. `1eb93b3` adds a comment written as a prohibition.
    //
    // **THIS ASSERTS THE CHEAP HALF: that no second caller has appeared.** It does NOT prove the
    // one caller verifies first — that would need dataflow analysis, and the Team Lead asked me
    // not to build something elaborate. What it does is turn "a second caller appeared" from
    // something nobody would notice into a red line, which is the failure mode the comment is
    // aimed at.
    //
    // Comments are stripped, so the prohibition's own mention of the name is not counted.
    const source = stripComments(handlersSource(), 'ts');
    // THE DECLARATION IS NOT A CALL SITE, and excluding it needs its own floor: an exclusion that
    // matched too much would drive the count to zero and this case would pass by finding nothing.
    // So the declaration is asserted present, then subtracted.
    const declarations = [...source.matchAll(/function decodeAuditAnchor\(/g)];
    assertEqual('the declaration is present exactly once', declarations.length, 1);
    const callSites = [...source.matchAll(/(?<!function )decodeAuditAnchor\(/g)];
    assertEqual(
      `${ISOLATION} exactly one call site in the handlers module`,
      callSites.length,
      1,
    );

    // AND NO OTHER MODULE UNDER `platform/core/**` CALLS IT AT ALL. The handlers file is where
    // the feed lives; a call from anywhere else is the shape the prohibition forbids.
    //
    // THE WALKER IS SHOWN TO FIND THINGS FIRST. An empty result is the answer this case wants,
    // and it is also what a walker reading no files returns — so a symbol that IS called across
    // `platform/core/**` is looked for, and must be found in several modules.
    const control = otherCoreModulesCalling('toRfc3339Utc');
    assertTrue(
      'the walker finds a symbol that IS called across platform/core',
      control.length >= 3,
      `the walker found toRfc3339Utc in only ${String(control.length)} modules, so an empty ` +
        'result below would mean it read nothing rather than that nothing calls the decoder',
    );

    const others = otherCoreModulesCalling('decodeAuditAnchor');
    assertEqual(
      `${ISOLATION} and no other module in platform/core calls it`,
      others.join(' · '),
      '',
    );
  });

  return suite;
}

/** Every module under `platform/core/**` except the handlers file that names `symbol` in code. */
function otherCoreModulesCalling(symbol: string): string[] {
  const root = fileURLToPath(new URL('../../../../platform/core/', import.meta.url));
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) {
        walk(`${path}/`);
        continue;
      }
      if (!entry.name.endsWith('.ts') || path === HANDLERS_PATH) {
        continue;
      }
      if (stripComments(readFileSync(path, 'utf8'), 'ts').includes(`${symbol}(`)) {
        found.push(path.slice(root.length));
      }
    }
  };
  walk(root);
  return found;
}
