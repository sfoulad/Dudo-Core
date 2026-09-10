/**
 * A CONSTRAINED STRUCTURAL SCANNER FOR THE DUDO CONTRACT YAML. NOT A YAML PARSER.
 * `docs/decisions/0037` · `docs/decisions/0009` (the zero-dependency precedent).
 *
 * ===========================================================================================
 * READ THIS BEFORE USING IT FOR ANYTHING ELSE
 * ===========================================================================================
 *
 * THIS IS NOT A YAML PARSER AND MUST NEVER BE DESCRIBED AS ONE. It answers a small, closed set
 * of questions about a corpus whose shape we control:
 *
 *   - which keys exist at column 0, and their inline scalar values;
 *   - the items of a top-level sequence, and each item's scalar sub-keys at one indent level.
 *
 * It does NOT implement anchors, aliases, tags, multi-document streams, flow sequences,
 * multi-line flow mappings, quoted keys, merge keys, or any of YAML's type coercion. It reads
 * every scalar as a STRING and never converts.
 *
 * WHY A SCANNER RATHER THAN A PARSER, AND WHY THAT IS NOT A CORNER BEING CUT. `0009` approved a
 * zero-dependency reader for one narrow job and said the precedent "cannot grow into a toolchain
 * without a new decision". A hand-written general YAML parser IS a toolchain: it would be the
 * largest untested surface in the repository, and every defect in it would present as a contract
 * saying something it does not say. A scanner that answers five questions and REFUSES everything
 * else is auditable in one sitting.
 *
 * ===========================================================================================
 * WHAT "FAILS CLOSED" MEANS HERE — CORRECTED 2026-09-09, AND THE CORRECTION IS THE POINT
 * ===========================================================================================
 *
 * THIS HEADER SAID "FAILS CLOSED, EVERYWHERE. Anything it cannot read confidently is reported as
 * unreadable and is never guessed at." *** THAT WAS FALSE WHEN IT WAS WRITTEN. *** `qa-agent`
 * constructed three inputs — a double-quoted key, a single-quoted key, and a plain key containing
 * a space — and every one was SILENTLY INVISIBLE: the key regex did not match, the line was
 * treated as prose, and `outlineYaml` returned `ok: true` with the key simply absent. A quoted
 * `'operations':` yielded `topLevelKeys: []` WITH NO ERROR.
 *
 * IT WAS `architecture.md` §3c INSIDE THIS FILE: a comment asserting a property the code did not
 * have, in the one place a reader would check for it. The downstream refusal still happened — a
 * missing required key trips the generator's own check — but THAT WAS THE CORPUS'S GOOD MANNERS,
 * NOT THIS SCANNER'S GUARANTEE, and the guarantee is what the sentence sold.
 *
 * WHAT IS NOW TRUE, STATED AS THREE SEPARATE CLAIMS RATHER THAN ONE SLOGAN:
 *
 *   1. QUOTED KEYS ARE REFUSED, at any indent. Unambiguous to detect, so there is no reason not to.
 *   2. AT COLUMN 0, ANYTHING THAT IS NOT A READABLE KEY IS REFUSED. Outside a block scalar a
 *      column-0 line can only be a key here, so the refusal costs nothing and protects the answers
 *      that matter most — a vanished top-level key makes every `hasKey()` result unreliable.
 *   3. *** AN INDENTED PLAIN KEY CONTAINING A SPACE IS STILL NOT DETECTED, AND THAT IS A KNOWN
 *      LIMITATION RATHER THAN A CLAIM. *** At depth, `some key: value` is indistinguishable from a
 *      line of prose without parsing the enclosing context properly — which is the parser this
 *      file exists not to be. A heuristic that guessed would refuse real contracts, and refusing
 *      valid input is not "failing closed", it is being broken in the safe direction.
 *
 * SO: it fails closed on everything it DETECTS, and clause 3 is what it does not detect. That is a
 * weaker sentence than the original and it is the true one.
 *
 * ===========================================================================================
 * THE ONE HAZARD THAT WOULD MAKE IT SILENTLY WRONG, AND HOW IT IS HANDLED
 * ===========================================================================================
 *
 * BLOCK SCALARS CONTAIN PROSE THAT LOOKS LIKE YAML. These contracts are mostly `>-` blocks, and
 * that prose is full of sentences like "status: proposed" and "permission: core.x" written as
 * examples or as quotations. A scanner that did not skip block bodies would read those as
 * structure — and it would do so CONFIDENTLY, producing a contract outline that disagrees with
 * the contract.
 *
 * So `enterBlockScalar` below is the load-bearing part of this file, not an optimisation: a key
 * whose inline value begins `|` or `>` (with any of the `+`, `-` and digit indicators) opens a
 * block, and EVERY line more-indented than that key is skipped without inspection until a
 * non-blank line at or left of the key's own indent.
 *
 * A COMMENT IS ONLY A COMMENT WHERE YAML SAYS IT IS. `#` starts a comment at the beginning of a
 * line, or when preceded by whitespace and not inside a quoted scalar. `updated: "2026-09-05"`
 * has no comment; `apiVersion: null   # see below` does. Getting this wrong in the other
 * direction would truncate values at the first `#` inside a quoted string.
 */

/** Every refusal this module can produce. Stable; referenced by the generator's report. */
export const OUTLINE_ERROR_CODES = Object.freeze({
  INPUT_NOT_A_STRING: 'OUTLINE_INPUT_NOT_A_STRING',
  TAB_INDENTATION: 'OUTLINE_TAB_INDENTATION',
  UNSUPPORTED_CONSTRUCT: 'OUTLINE_UNSUPPORTED_CONSTRUCT',
  DUPLICATE_TOP_LEVEL_KEY: 'OUTLINE_DUPLICATE_TOP_LEVEL_KEY',
});

const KEY_LINE = /^(\s*)([A-Za-z_][A-Za-z0-9_.\-]*):(?:[ \t](.*))?$/;
/**
 * The first group captures the WHOLE PREFIX — indent, dash and following whitespace — because its
 * length is the KEY'S column, which is not the dash's column.
 *
 * *** THAT DISTINCTION IS DEFECT CASE 1, FOUND BY `qa-agent` ON 2026-09-09. *** The first version
 * captured only the indent and used the DASH's column as the block-scalar skip window. An item's
 * sibling keys sit two columns right of the dash, so for
 *
 *     - description: >-
 *         ...prose...
 *       id: fixture.Echo
 *
 * every sibling key was INSIDE the skip window and vanished. The outline returned one field where
 * a real YAML parser returns five. It failed closed in the generator by luck — a missing required
 * key trips a refusal — but it reported the wrong defect, and `yaml-outline.mjs` is a shared
 * module: a consumer reading `sensitivity` or `scope` would have got silence, which is the
 * fail-OPEN direction.
 *
 * The corpus never triggered it because every item happens to open with `- id:`, whose value is
 * not a block scalar. A property of the corpus, not of this scanner.
 */
const SEQUENCE_KEY_LINE = /^((\s*)-[ \t]+)([A-Za-z_][A-Za-z0-9_.\-]*):(?:[ \t](.*))?$/;
const BLOCK_SCALAR_VALUE = /^[|>][+\-]?\d*$/;
/** A quoted key is unambiguous in YAML and this scanner refuses it rather than skipping it. */
const QUOTED_KEY_LINE = /^\s*(?:"[^"]*"|'[^']*')\s*:(?:[ \t].*)?$/;

/**
 * Constructs that this scanner refuses rather than misreads. Each would parse as something under
 * a real YAML implementation and as something ELSE here, which is the only kind of gap worth
 * failing on: a construct we simply do not use is harmless, and one we would read differently is
 * a contract saying what it does not say.
 */
const UNSUPPORTED_LINE = [
  { pattern: /^\s*<<\s*:/, what: 'a merge key' },
  { pattern: /^\s*[&*][A-Za-z0-9_-]+/, what: 'an anchor or alias' },
  { pattern: /^---\s*\S/, what: 'a document with a directive or an inline root' },
  { pattern: /^\s*\?[ \t]/, what: 'an explicit complex key' },
];

/** Strips a trailing comment, honouring single and double quotes. Never called on a block body. */
function stripTrailingComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** Removes one layer of surrounding quotes. Does NOT unescape — no caller needs it to. */
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function normalizeInlineValue(rawValue) {
  if (rawValue === undefined) return null;
  const stripped = stripTrailingComment(rawValue).trim();
  if (stripped === '') return null;
  return unquote(stripped);
}

/**
 * Reads a single-line flow mapping — `{ schemaRef: "urn:...", other: 2 }` — into a plain object.
 *
 * DELIBERATELY SINGLE-LINE ONLY. A flow mapping spanning lines is refused by the caller rather
 * than assembled here, because assembling it correctly is the beginning of a parser.
 * Returns null when the value is not a flow mapping at all, which is how a caller distinguishes
 * `request: { schemaRef: ... }` from `request: "prose describing the request"`.
 */
export function readInlineFlowMapping(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const body = trimmed.slice(1, -1);
  const out = Object.create(null);
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let current = '';
  const parts = [];
  for (const ch of body) {
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    if (!inSingle && !inDouble) {
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '') parts.push(current);
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) return null;
    const key = part.slice(0, colon).trim();
    if (key === '') return null;
    out[key] = unquote(part.slice(colon + 1));
  }
  return out;
}

/**
 * Reads a single-line flow sequence — `[a, b, c]` — into an array of strings.
 * Used for `errors: [invalid_argument, unauthenticated, ...]`, which is how every contract in the
 * corpus writes its error list. A multi-line block sequence in that position is refused.
 */
export function readInlineFlowSequence(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const body = trimmed.slice(1, -1).trim();
  if (body === '') return [];
  return body.split(',').map((entry) => unquote(entry)).filter((entry) => entry !== '');
}

/**
 * Scans a contract document into an outline.
 *
 * @returns {{ ok: true, outline: object } | { ok: false, errors: Array<{code:string,line:number,message:string}> }}
 */
export function outlineYaml(text) {
  if (typeof text !== 'string') {
    return {
      ok: false,
      errors: [
        {
          code: OUTLINE_ERROR_CODES.INPUT_NOT_A_STRING,
          line: 0,
          message: 'outlineYaml requires the document text as a string.',
        },
      ],
    };
  }

  const errors = [];
  const lines = text.split(/\r?\n/);

  /** @type {Map<string, string|null>} column-0 keys to their inline scalar value. */
  const topLevel = new Map();
  /** @type {Map<string, number>} column-0 key to the line it was declared on (1-based). */
  const topLevelLines = new Map();
  /** @type {Map<string, Array<{ fields: Map<string,string|null>, line: number }>>} */
  const sequences = new Map();

  let currentTopLevelKey = null;
  let currentSequenceItem = null;

  let blockIndent = -1; // >= 0 while inside a block scalar; the indent of the key that opened it.

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNumber = i + 1;

    if (line.trim() === '') continue;

    const indent = line.length - line.trimStart().length;

    // ---- Inside a block scalar: skip without inspection. See the header.
    if (blockIndent >= 0) {
      if (indent > blockIndent) continue;
      blockIndent = -1;
    }

    if (/^\s*#/.test(line)) continue;
    if (line.trim() === '---' || line.trim() === '...') continue;

    if (/^\s*\t/.test(line) || /\t/.test(line.slice(0, indent))) {
      errors.push({
        code: OUTLINE_ERROR_CODES.TAB_INDENTATION,
        line: lineNumber,
        message: 'Tab indentation. YAML forbids it and this scanner will not guess a width.',
      });
      continue;
    }

    const unsupported = UNSUPPORTED_LINE.find((entry) => entry.pattern.test(line));
    if (unsupported !== undefined) {
      errors.push({
        code: OUTLINE_ERROR_CODES.UNSUPPORTED_CONSTRUCT,
        line: lineNumber,
        message: `This scanner refuses ${unsupported.what} rather than misreading it.`,
      });
      continue;
    }

    // ---- A sequence item that opens with a key: `  - id: core.Something`
    // ---- A QUOTED KEY IS REFUSED, NOT SKIPPED. Defect CASE 2/3, 2026-09-09.
    if (QUOTED_KEY_LINE.test(line)) {
      errors.push({
        code: OUTLINE_ERROR_CODES.UNSUPPORTED_CONSTRUCT,
        line: lineNumber,
        message:
          'A quoted key. This scanner does not read quoted keys, and it refuses rather than ' +
          'skipping — silently skipping one made the key INVISIBLE with no error, which is the ' +
          'opposite of what this file promises.',
      });
      continue;
    }

    const sequenceMatch = SEQUENCE_KEY_LINE.exec(line);
    if (sequenceMatch !== null && currentTopLevelKey !== null) {
      const [, prefix, , key, rawValue] = sequenceMatch;
      // THE KEY'S COLUMN, NOT THE DASH'S. See SEQUENCE_KEY_LINE's comment — defect CASE 1.
      const keyColumn = prefix.length;
      const item = { fields: new Map(), line: lineNumber };
      item.fields.set(key, normalizeInlineValue(rawValue));
      if (!sequences.has(currentTopLevelKey)) sequences.set(currentTopLevelKey, []);
      sequences.get(currentTopLevelKey).push(item);
      currentSequenceItem = item;
      if (rawValue !== undefined && BLOCK_SCALAR_VALUE.test(stripTrailingComment(rawValue).trim())) {
        blockIndent = keyColumn;
      }
      continue;
    }

    const keyMatch = KEY_LINE.exec(line);

    // ---- AT COLUMN 0, ANYTHING THAT IS NOT A KEY IS REFUSED. Defect CASE 4, 2026-09-09.
    //
    // Outside a block scalar, a column-0 line in this corpus can only be a key: blanks, comments
    // and document markers are already handled above, and a value continuation is indented. So
    // the ambiguity that makes the INDENTED case undecidable does not exist here, and a top-level
    // key going invisible is the dangerous one — it is what makes `hasKey('tenancy')` lie.
    if (keyMatch === null && indent === 0) {
      errors.push({
        code: OUTLINE_ERROR_CODES.UNSUPPORTED_CONSTRUCT,
        line: lineNumber,
        message:
          'A column-0 line that is not a key this scanner reads — a key containing a space, an ' +
          'unusual character, or a construct outside the supported subset. Refused rather than ' +
          'skipped, because a top-level key that vanishes silently makes every hasKey() answer ' +
          'unreliable.',
      });
      continue;
    }

    if (keyMatch === null) continue; // Indented: a folded continuation, a list item, prose. Not structure.

    const [, indentText, key, rawValue] = keyMatch;
    const keyIndent = indentText.length;
    const value = normalizeInlineValue(rawValue);
    const opensBlock =
      rawValue !== undefined && BLOCK_SCALAR_VALUE.test(stripTrailingComment(rawValue).trim());

    if (keyIndent === 0) {
      if (topLevel.has(key)) {
        errors.push({
          code: OUTLINE_ERROR_CODES.DUPLICATE_TOP_LEVEL_KEY,
          line: lineNumber,
          message: `'${key}' appears twice at the top level; first at line ${topLevelLines.get(key)}. A duplicate key is a document whose meaning depends on the reader.`,
        });
      }
      topLevel.set(key, value);
      topLevelLines.set(key, lineNumber);
      currentTopLevelKey = key;
      currentSequenceItem = null;
    } else if (currentSequenceItem !== null && keyIndent > 0) {
      // A sub-key of the sequence item currently open. Only the FIRST occurrence is kept, so a
      // nested structure cannot overwrite the item's own field.
      if (!currentSequenceItem.fields.has(key)) currentSequenceItem.fields.set(key, value);
    }

    if (opensBlock) blockIndent = keyIndent;
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    outline: {
      /** @returns {boolean} */
      hasKey: (key) => topLevel.has(key),
      /** @returns {string|null} the inline scalar, or null when the key opens a block or is absent. */
      scalar: (key) => (topLevel.has(key) ? topLevel.get(key) : null),
      /** @returns {number|null} 1-based line of a top-level key. */
      lineOf: (key) => (topLevelLines.has(key) ? topLevelLines.get(key) : null),
      /** @returns {string[]} every column-0 key, in document order. */
      topLevelKeys: () => [...topLevel.keys()],
      /** @returns {Array<{ fields: Map<string,string|null>, line: number }>} */
      items: (key) => sequences.get(key) ?? [],
    },
  };
}
