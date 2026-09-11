/**
 * ===========================================================================================
 * A HAND-WRITTEN DECLARATION FOR `packages/contracts/generator/generate-types.mjs`.
 * ===========================================================================================
 *
 * That file is plain `.mjs` with no types, and it is `architecture-agent`'s. Under `noImplicitAny`
 * a suite cannot import it at all without this.
 *
 * *** THIS IS A TRANSCRIPTION, AND TRANSCRIPTIONS DRIFT. SAY SO RATHER THAN TRUST IT. ***
 *
 * It describes another agent's module from the outside. If the generator changes the shape of what
 * it returns, **this file keeps compiling and starts lying** — the exact failure this repository
 * has hit repeatedly, one layer down.
 *
 * **What stops that being silent is a RUNTIME floor, not this declaration.**
 * `suites/contracts/generator-behaviour.ts` asserts that `run(...)` actually returned a `refusals`
 * ARRAY before reading it, and reports the object's real keys when it did not. That case exists
 * because an earlier probe read `report.errors` — a field that does not exist — and printed *"zero
 * refusals"* for a run that had two. **The type says what is expected; the floor checks what
 * arrived.** Keep both.
 *
 * Deliberately narrow: only the two exports the suites use, and `unknown` wherever the suite does
 * not depend on the shape. A wider declaration would be more to keep true and would buy nothing.
 */

/**
 * `scripts/lib/request-class.mjs` — `0039`'s checker, pure half. Same transcription caveat as
 * below: the RUNTIME floors in `suites/contracts/request-class-check.ts` are what catch a shape
 * change, not this declaration.
 */
declare module '*/request-class.mjs' {
  /** A well-formed route id: `namespace.Thing`, one or more dotted segments. */
  export const ROUTE_ID: RegExp;
  export const ID_LITERAL: RegExp;
  /**
   * The four request classes. `evaluatesPermission` is carried because it is WHY a wrong
   * declaration matters: two of the four consult no permission at all, so a contradiction across
   * that boundary is a false statement about who may call the route rather than a labelling slip.
   */
  export const CLASSES: Readonly<
    Record<string, { readonly blockKey: string; readonly record: string; readonly evaluatesPermission: boolean }>
  >;
  export const PUBLISHING_BLOCKS: readonly string[];

  /** `{id, declared, actual}` when the two differ and both are known; `null` otherwise. */
  export type ClassContradiction = {
    readonly id: string;
    readonly declared: string;
    readonly actual: string;
    readonly file?: string;
    readonly source?: string;
  };

  export function parseContract(source: string): {
    readonly contractClass?: string;
    readonly blockKey?: string;
    readonly operations: ReadonlyArray<{ readonly id: string; readonly ownClass?: string }>;
  };

  /** Every route-id literal in one source file, both `id:` and `actionId:` spellings. */
  export function idLiteralsIn(source: string): ReadonlySet<string>;

  export function contradiction(
    id: string,
    declared: string | undefined,
    actual: string | undefined,
  ): ClassContradiction | null;
  export function disagreement(
    executed: ReadonlySet<string>,
    textual: ReadonlySet<string>,
  ): { readonly textualOnly: readonly string[]; readonly executedOnly: readonly string[] };
  export function compare(
    contracts: ReadonlyArray<{
      readonly file: string;
      readonly contractClass?: string;
      readonly blockKey?: string;
      readonly operations: ReadonlyArray<{ readonly id: string; readonly ownClass?: string }>;
    }>,
    executedClassOf: ReadonlyMap<string, { readonly className: string; readonly source: string }>,
  ): {
    readonly contradictions: readonly ClassContradiction[];
    readonly unregistered: readonly Record<string, unknown>[];
    readonly unknownClasses: readonly Record<string, unknown>[];
    readonly malformed: readonly Record<string, unknown>[];
    readonly spans: readonly Record<string, unknown>[];
    readonly undeclared: readonly string[];
    readonly uncontracted: readonly string[];
    readonly declaredIds: ReadonlySet<string>;
  };
}

declare module '*/generate-types.mjs' {
  /** A refusal as the generator reports it. `contract` is absent on schema-level refusals. */
  export type GeneratorRefusal = {
    readonly code: string;
    readonly message: string;
    readonly contract?: string;
  };

  /**
   * Who a refusal code is addressed to. **THROWS on a code the generator does not declare**, which
   * is why it is preferred over indexing `REFUSAL_AUTHOR`: `map[code]` on an unknown code yields
   * `undefined`, a caller compares it to `'contract'`, gets `false`, and reports "not a contract
   * deficiency" — a wrong answer wearing a correct one's clothes.
   *
   * It replaced a regex `qa-agent` had over this module's source text. That reader was fail-closed
   * and controlled, and it still carried a hazard beyond transcription: **reformat the object and
   * the reader silently stops seeing entries while every assertion it still makes passes.**
   * Check-handed-half, through a parser nobody meant to write. Bind to the running map.
   */
  export function refusalAuthorFor(code: string): 'contract' | 'generator' | 'derived';

  /**
   * The exit code one report implies. **Exported 2026-09-10 so the precedence can be ASSERTED
   * rather than re-implemented** — `qa-agent` declined to write a second copy of the rule in its
   * own file, and the export is the answer to that refusal.
   *
   * `0` clean · `1` the corpus is wrong · `2` the tool's own accounting is broken · `3` a decision
   * is due. **Order is precedence and corpus problems win.**
   */
  export function exitCodeFor(report: unknown): 0 | 1 | 2 | 3;

  /** Pure: no file access, so it is testable without a filesystem. */
  export function emitModule(input: {
    readonly schema: unknown;
    readonly contractName: string;
    readonly sourceName: string;
    readonly schemaIndex: ReadonlyMap<string, unknown>;
    readonly operations: readonly unknown[];
  }): {
    readonly errors?: readonly GeneratorRefusal[];
    readonly warnings?: readonly { readonly message: string }[];
    readonly text?: string;
    readonly source?: string;
  };

  /** One committed module that no longer matches a fresh generation from its source. */
  export type GeneratorDrift = {
    readonly contract: string;
    readonly path: string;
    readonly reason: string;
  };

  export function run(options?: {
    readonly mode?: 'emit' | 'check';
    readonly root?: string;
    readonly outputRoot?: string;
  }): {
    readonly refusals?: readonly GeneratorRefusal[];
    readonly warnings?: readonly unknown[];
    readonly drift?: readonly GeneratorDrift[];
    readonly population?: Readonly<Record<string, number>>;
    /**
     * Set when a `0039`/`0041` phase boundary is reached. **Not an error** — the generator's own
     * exit codes carry it (`3` migration due) and `suites/contracts/generator-gate.ts` asserts the
     * conditions directly, because an exit code is for a human running a tool and a suite assertion
     * is what a gate can read.
     */
    readonly migrationNotice?: string;
    readonly fatal?: string;
  };
}
