/**
 * Source-text helpers for the suites that assert a property by reading Dudo's own files.
 *
 * ===========================================================================================
 * WHY A COMMENT STRIPPER IS NEEDED AT ALL, WHICH IS NOT OBVIOUS UNTIL THE FIRST RED RUN
 * ===========================================================================================
 *
 * Dudo's source records its own boundaries in prose, at length, in the files those boundaries
 * constrain. `platform/core/platform/**` explains repeatedly that it holds no `TenantStoreResolver`
 * — that documentation IS where the property is recorded — and `templates.ts` states the
 * business-type rule using `School`, `Dental Clinic`, `Salon` and `Retail` as its examples.
 *
 * **SO EVERY "no file under X names Y" CHECK IN THIS REPOSITORY WOULD FAIL ON THE SENTENCE THAT
 * ASSERTS THE THING IT IS TESTING.** The stripper is what makes the whole class of check runnable.
 *
 * ===========================================================================================
 * IT IS A LEXER'S APPROXIMATION AND NOT A PARSER, AND THE DIRECTION OF THE ERROR MATTERS
 * ===========================================================================================
 *
 * A `//` or `--` inside a string literal is treated as the start of a comment, so more text may be
 * removed than a parser would remove. **Over-stripping can only make a caller's check weaker,
 * never falsely red.** A green result from a caller is therefore a slightly weaker claim than "the
 * code does not contain this name"; a red result is exact. Every caller states that limit rather
 * than implying the stronger one.
 *
 * MOVED HERE FROM `suites/platform-operator/no-tenant-reach.ts` on 2026-09-05, when the
 * business-type boundary check needed the same lexer. Two copies of a heuristic are two
 * heuristics: the copy that gets fixed and the copy that does not.
 */

export type CommentSyntax = 'ts' | 'sql';

/**
 * Removes comments from TypeScript or SQL source.
 *
 * `ts` removes `/* ... *\/` and `// ...`. `sql` removes `-- ...` and, because the migrations use
 * it, `/* ... *\/` as well.
 */
export function stripComments(source: string, syntax: CommentSyntax = 'ts'): string {
  const lineComment = syntax === 'sql' ? '--' : '//';
  let output = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith(lineComment, index)) {
      const end = source.indexOf('\n', index);
      index = end === -1 ? source.length : end;
      continue;
    }
    output += source[index];
    index += 1;
  }
  return output;
}
