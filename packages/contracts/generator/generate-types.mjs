/**
 * THE CONTRACT TYPE GENERATOR. `docs/decisions/0037`, Milestone 0 item 5 (`docs/decisions/0035`).
 *
 * Reads the contract corpus and emits TypeScript request, response and error types, so that
 * `platform/web/**` and `platform/core/**` consume the contracts instead of re-typing them by
 * hand. `0034` is the defect this exists to stop reproducing at Milestone scale: the console sent
 * `identifier`, the contract published `target_identifier`, and the route worked because the
 * client had read the code rather than the contract.
 *
 * ZERO DEPENDENCIES, NODE STANDARD RUNTIME ONLY. `0009`'s answer to the same question for a
 * different consumer, and `0037` chose it over `json-schema-to-typescript` explicitly. No
 * package.json, no lockfile, no framework.
 *
 * ===========================================================================================
 * *** THIS FILE HAS NEVER BEEN EXECUTED. ***
 * ===========================================================================================
 *
 * `architecture-agent` authored it and HAS NO SHELL — Bash is not in its toolset, so it could not
 * run `node`, could not emit the committed output `0037` requirement 1 calls for, and could not
 * observe a single one of the behaviours described below.
 *
 * SO EVERY CLAIM IN THIS HEADER IS A DESIGN INTENT, NOT A MEASUREMENT, and `workflow.md` §10's
 * four states apply: this is NOT RUN, which is not the same as passing and not the same as
 * failing. **Nothing may report this generator as working, and no output of it may be committed,
 * until somebody with a shell has run it and reported actual results.** A generator that emits
 * plausible-but-wrong types is worse than hand-written ones, because it carries the authority of
 * having been generated (`0037`, "The cost, stated").
 *
 * THE FIRST RUN IS EXPECTED TO REFUSE SEVERAL REAL CONTRACTS. That is requirement 2 working, not
 * a defect — see `admitContract`. If it emits cleanly for all fifteen on the first attempt,
 * suspect the admission check before celebrating.
 *
 * ===========================================================================================
 * USAGE
 * ===========================================================================================
 *
 *   node packages/contracts/generator/generate-types.mjs            emit, writing files
 *   node packages/contracts/generator/generate-types.mjs --check    drift check, writes nothing
 *   node packages/contracts/generator/generate-types.mjs --self-test  run the known-failing input
 *
 * `--check` is `0037` requirement 3 and joins the gate ONLY on the day it exits 0 (requirement 4,
 * and the same rule `package.json` records for `check:source-bytes`: a red gate folded into a
 * green one makes the green one worthless).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outlineYaml, readInlineFlowSequence } from './yaml-outline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_ROOT = resolve(HERE, '..');
const OUTPUT_ROOT = join(CONTRACTS_ROOT, 'generated');

/** Stable refusal codes. Referenced by the report and by whoever writes the suite case. */
export const GENERATOR_ERROR_CODES = Object.freeze({
  YAML_UNREADABLE: 'GEN_YAML_UNREADABLE',
  SCHEMA_UNREADABLE: 'GEN_SCHEMA_UNREADABLE',
  SCHEMA_MISSING: 'GEN_SCHEMA_MISSING',
  NO_OPERATIONS_BLOCK: 'GEN_NO_OPERATIONS_BLOCK',
  MISSING_REQUEST_SHAPE: 'GEN_MISSING_REQUEST_SHAPE',
  MISSING_RESPONSE_SHAPE: 'GEN_MISSING_RESPONSE_SHAPE',
  MISSING_ERROR_CASES: 'GEN_MISSING_ERROR_CASES',
  MISSING_AUTHORIZATION: 'GEN_MISSING_AUTHORIZATION',
  MISSING_TENANT_SCOPE: 'GEN_MISSING_TENANT_SCOPE',
  MISSING_REQUEST_CLASS: 'GEN_MISSING_REQUEST_CLASS',
  MISSING_ENUM_POLICY: 'GEN_MISSING_ENUM_POLICY',
  UNKNOWN_ENUM_POLICY: 'GEN_UNKNOWN_ENUM_POLICY',
  MISSING_VARIANT_POLICY: 'GEN_MISSING_VARIANT_POLICY',
  UNKNOWN_VARIANT_POLICY: 'GEN_UNKNOWN_VARIANT_POLICY',
  REF_UNRESOLVABLE_INDEX_INCOMPLETE: 'GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE',
  UNDISCRIMINATED_VARIANT_UNION: 'GEN_UNDISCRIMINATED_VARIANT_UNION',
  AMBIGUOUS_VARIANT_DISCRIMINANT: 'GEN_AMBIGUOUS_VARIANT_DISCRIMINANT',
  RESERVED_VARIANT_NAME: 'GEN_RESERVED_VARIANT_NAME',
  UNKNOWN_REQUEST_CLASS: 'GEN_UNKNOWN_REQUEST_CLASS',
  REQUEST_CLASS_CONTRADICTS_BLOCK: 'GEN_REQUEST_CLASS_CONTRADICTS_BLOCK',
  UNRESOLVABLE_REF: 'GEN_UNRESOLVABLE_REF',
  UNSUPPORTED_SCHEMA_NODE: 'GEN_UNSUPPORTED_SCHEMA_NODE',
  UNSUPPORTED_REF_FORM: 'GEN_UNSUPPORTED_REF_FORM',
  UNEMITTABLE_DEPENDENCY: 'GEN_UNEMITTABLE_DEPENDENCY',
});

/**
 * The three key names this corpus uses for "the things this contract publishes".
 *
 * *** THERE ARE THREE, AND THAT IS A FINDING RATHER THAN A CONVENIENCE. *** Tenant Action
 * contracts say `actions:`, platform contracts say `operations:`, and `login-v1` says
 * `entryPoints:`. Nothing has ever compared them because nothing parsed this YAML. Accepting all
 * three here is deliberate — refusing two of them would be this generator deciding a naming
 * convention on its own authority, which is not its job — and the divergence is REPORTED so the
 * Team Lead can rule on it rather than have it silently normalised away.
 */
const OPERATION_BLOCK_KEYS = Object.freeze(['actions', 'operations', 'entryPoints']);

/**
 * THE SHAPE-KEY VOCABULARY IS PER CLASS, AND THAT IS A CORRECTION MADE ON 2026-09-09 AFTER THE
 * FIRST RUN.
 *
 * The first version used one flat pair — `input|request` and `output|response` — for every class,
 * and it produced SEVEN FALSE REFUSALS against `login-v1`: three `MISSING_REQUEST_SHAPE` and four
 * `MISSING_RESPONSE_SHAPE`, on a contract that declares both for every entry point.
 *
 * *** BOTH CAUSES WERE THE TOOL, AND NEITHER WAS THE BLOCK-KEY NAME. *** That matters, because the
 * obvious diagnosis — "the reader expects a shape it only looks for under `actions:`/
 * `operations:`" — would have reopened the ruling that `actions`/`operations`/`entryPoints` are
 * three real classes. They are, `blockKey` resolution worked correctly throughout, and the ruling
 * stands:
 *
 *   1. A PRE-AUTH ENTRY POINT SPELLS ITS RESPONSE `successBody:`. Not a synonym for `output:` —
 *      an entry point returns a body AND may set a credential (`setsCredential:`), so it is not an
 *      Action's "output" and calling it one would be the flattening this generator refuses
 *      elsewhere. THE CLASS DISTINCTION REACHES FURTHER INTO THE CONTRACT SHAPE THAN THE BLOCK
 *      KEY, which is the argument for a declared `requestClass:` field rather than an
 *      ever-growing union of accepted key names.
 *   2. A KEY OPENING A NESTED MAPPING HAS NO INLINE VALUE. `login-v1`'s `request:` is followed by
 *      `fields:` and `note:` on the next lines. The admission check tested `get(k) != null` —
 *      A VALUE TEST — where the question is PRESENCE. A declared request shape that happens not to
 *      be a one-liner is still declared.
 */
const SHAPE_KEYS_BY_CLASS = Object.freeze({
  actions: Object.freeze({
    request: Object.freeze(['input', 'request']),
    response: Object.freeze(['output', 'response']),
  }),
  operations: Object.freeze({
    request: Object.freeze(['request', 'input']),
    response: Object.freeze(['response', 'output']),
  }),
  entryPoints: Object.freeze({
    request: Object.freeze(['request']),
    response: Object.freeze(['successBody', 'response']),
  }),
});

/**
 * ===========================================================================================
 * WHO EACH REFUSAL IS ADDRESSED TO. AN EXPLICIT MAP, NOT A PREFIX TEST.
 * ===========================================================================================
 *
 * The composition line used `code.startsWith('GEN_MISSING_')` to decide whether a refusal named a
 * CONTRACT deficiency or a defect in this generator. **It misattributed one:**
 * `GEN_NO_OPERATIONS_BLOCK` is a contract deficiency — its own message says so — and carries no
 * `MISSING_` prefix, so the report told a reader to look for a bug in this tool that is not there.
 *
 * *** THE PREFIX WAS A SECOND ENCODING OF A FACT THE CODE LIST ALREADY KNEW, AND IT IS `§1a`
 * AGAIN: A NAME CARRYING A PROPERTY IT WAS NOT DESIGNED TO CARRY. *** A prefix convention would
 * have to be maintained by whoever adds the next code, silently, with the failure mode being a
 * misattribution nobody can see. This map cannot be forgotten: the assertion below fails at module
 * load if a code has no entry.
 *
 * THREE CATEGORIES, NOT TWO, AND THE THIRD IS WHY THE SPLIT WAS INFLATED:
 *
 *   contract  — the contract omits or misstates something. The reader edits a contract.
 *   generator — this tool does not implement something. The reader fixes this file.
 *   derived   — a CONSEQUENCE of another refusal in the same run. It has no author of its own,
 *               and counting it on either side double-counts one defect. `UNEMITTABLE_DEPENDENCY`
 *               is the only one: a module refused because something it imports was refused.
 */
/**
 * *** EXPORTED, 2026-09-10, BECAUSE A SUITE WAS READING IT WITH A REGEX OVER THIS FILE'S SOURCE. ***
 *
 * `run()`'s report carries a refusal's CODE and not its AUTHOR, `formatReport` is not exported, and
 * this map was module-private — so `qa-agent`, needing to assert the contract/generator/derived
 * split, had to parse the text of this object. It declared that as a transcription hazard, failed
 * closed, and pinned a second value through the same reader as a control. That was good handling of
 * a bad situation and the bad situation was mine to remove.
 *
 * A CHECK THAT READS A SOURCE FILE AS TEXT IS ASSERTING ABOUT A STRING, NOT ABOUT THE RUNNING MAP.
 * Reformat this object — one entry per line becoming two, a trailing comma moving — and the reader
 * silently stops seeing entries while every assertion it makes still passes on the ones it found.
 * That is `§11a`'s check-handed-half, arriving through a parser nobody meant to write.
 *
 * Prefer `refusalAuthorFor(code)` at a call site: it refuses an unknown code rather than returning
 * `undefined`, so a suite cannot assert about a code this generator does not declare.
 */
export const REFUSAL_AUTHOR = Object.freeze({
  GEN_YAML_UNREADABLE: 'generator',
  GEN_SCHEMA_UNREADABLE: 'contract',
  GEN_SCHEMA_MISSING: 'contract',
  GEN_NO_OPERATIONS_BLOCK: 'contract',
  GEN_MISSING_REQUEST_SHAPE: 'contract',
  GEN_MISSING_RESPONSE_SHAPE: 'contract',
  GEN_MISSING_ERROR_CASES: 'contract',
  GEN_MISSING_AUTHORIZATION: 'contract',
  GEN_MISSING_TENANT_SCOPE: 'contract',
  GEN_MISSING_REQUEST_CLASS: 'contract',
  GEN_MISSING_ENUM_POLICY: 'contract',
  GEN_UNKNOWN_ENUM_POLICY: 'contract',
  GEN_MISSING_VARIANT_POLICY: 'contract',
  GEN_UNKNOWN_VARIANT_POLICY: 'contract',
  // A union of object shapes with no discriminant is a CONTRACT defect and not a generator gap:
  // no client can narrow it, `0041` cannot be declared on it, and the repair is in the schema.
  // *** THE SECOND `derived` CODE, AND IT EXISTS BECAUSE CLASSIFICATION BY CODE COULD NOT SEE THIS
  // ONE. *** `GEN_UNRESOLVABLE_REF` is authored `contract` and rightly so: a URN naming an `$id`
  // nothing declares is a contract defect. But the SAME code fires when the `$id` IS declared, by a
  // file that failed to parse — and then it is a consequence of that parse failure, not a defect of
  // the referring contract. The map keys on codes; this distinction is per-OCCURRENCE, so no remap
  // could ever have expressed it and a separate code is the only honest carrier.
  //
  // MEASURED, 2026-09-10: one missing comma in `template-v1.schema.json` produced SIX refusals —
  // one `GEN_SCHEMA_UNREADABLE` and FIVE `GEN_UNRESOLVABLE_REF` from `template-lifecycle-v1`, which
  // resolves five URNs into that file. The report read as six contract deficiencies where there was
  // ONE, and the derived-counting logic that exists to separate causes from effects did not fire.
  GEN_REF_UNRESOLVABLE_INDEX_INCOMPLETE: 'derived',
  GEN_UNDISCRIMINATED_VARIANT_UNION: 'contract',
  GEN_AMBIGUOUS_VARIANT_DISCRIMINANT: 'contract',
  GEN_RESERVED_VARIANT_NAME: 'contract',
  GEN_UNKNOWN_REQUEST_CLASS: 'contract',
  GEN_REQUEST_CLASS_CONTRADICTS_BLOCK: 'contract',
  GEN_UNRESOLVABLE_REF: 'contract',
  GEN_UNSUPPORTED_SCHEMA_NODE: 'generator',
  GEN_UNSUPPORTED_REF_FORM: 'generator',
  GEN_UNEMITTABLE_DEPENDENCY: 'derived',
});

/**
 * The authorship of one refusal code. REFUSES AN UNKNOWN CODE rather than returning `undefined`.
 *
 * That is the whole reason to prefer it over indexing `REFUSAL_AUTHOR` directly: `map[code]` on a
 * code this generator does not declare yields `undefined`, which a caller then compares against
 * `'contract'`, gets `false`, and reports as "not a contract deficiency" — A WRONG ANSWER WEARING A
 * CORRECT ONE'S CLOTHES. The load-time assertion below guarantees every DECLARED code has an entry;
 * this guarantees a caller cannot ask about an undeclared one and be quietly told something.
 */
export function refusalAuthorFor(code) {
  const author = REFUSAL_AUTHOR[code];
  if (author === undefined) {
    throw new Error(
      `refusalAuthorFor: \`${code}\` is not a refusal code this generator declares. ` +
        `Declared codes: ${Object.keys(REFUSAL_AUTHOR).join(', ')}.`,
    );
  }
  return author;
}

/**
 * Every declared code has an author, checked at load. A code added without an entry would fall
 * into whatever the reader assumed — which is the defect this map replaces, returning through the
 * door the map was built to close.
 */
for (const code of Object.values(GENERATOR_ERROR_CODES)) {
  if (REFUSAL_AUTHOR[code] === undefined) {
    throw new Error(
      `GENERATOR_ERROR_CODES declares '${code}' and REFUSAL_AUTHOR does not say who it addresses. Add it as 'contract', 'generator' or 'derived' — a refusal that sends a reader to the wrong file costs more than the defect it reports.`,
    );
  }
}

/**
 * THE FOUR REQUEST CLASSES, AND THE FIELD THAT DECLARES ONE. `docs/decisions/0039`.
 *
 * *** FOUR CLASSES, THREE BLOCK KEYS, AND `operations:` COVERS TWO OF THEM. *** That is the
 * measurement `0039` is built on and the reason a block key cannot carry the class:
 * `organization-selection-v1` uses `operations:` for SESSION-class routes, and a reader inferring
 * the class from the key gets it wrong.
 *
 * A FOURTH KEY NAME WAS REFUSED. It would encode the same property the same implicit way and be
 * stale the next time a class is added. **The problem is a structural key carrying a semantic
 * property**, and no number of key names fixes that.
 */
const REQUEST_CLASSES = Object.freeze({
  'pre-auth': Object.freeze({ blockKey: 'entryPoints', record: '0014 §B', evaluatesPermission: false }),
  session: Object.freeze({ blockKey: 'operations', record: '0021', evaluatesPermission: false }),
  platform: Object.freeze({ blockKey: 'operations', record: '0025 decision 3', evaluatesPermission: true }),
  action: Object.freeze({ blockKey: 'actions', record: 'ARCHITECTURE.md §3', evaluatesPermission: true }),
});

/**
 * *** PHASE 1 OF `0039`. FLIP THIS WHEN EVERY CONTRACT DECLARES `requestClass:`. ***
 *
 * While false, an undeclared class is a WARNING and the shape vocabulary falls back to the block
 * key — which preserves today's behaviour exactly and lets the field land contract by contract.
 * While true, an undeclared class is a REFUSAL.
 *
 * THE FLIP IS NOT LEFT TO ANYONE'S MEMORY. `run` counts contracts still lacking the field, and
 * when that count reaches zero with this constant still `false` it reports a FATAL telling
 * whoever is reading to flip it. `0034`'s three-phase rename is the pattern; the difference is
 * that phase 3's trigger fails the run rather than sitting in a comment.
 */
const REQUEST_CLASS_REQUIRED = false;

/**
 * *** PHASE 1 OF `docs/decisions/0041`. FLIP WHEN EVERY ENUM DECLARES A POLICY. ***
 *
 * While false, an undeclared `enumPolicy` is a WARNING and the emitted type is unchanged from what
 * this generator produced before `0041` existed.
 *
 * WHY IT IS PHASED AT ALL, AND THE REASON IS NOT CAUTION. Every enum in the corpus is undeclared,
 * a refusal stops emission, and **`web-agent` is converting Milestone 1 screens against these
 * generated types right now.** Refusing on arrival would have taken the types away from consumers
 * **because a new requirement landed before its own migration** — which is `0037`'s own users
 * paying for a rule written to protect them.
 *
 * `0039` phase 1 is the precedent and the shape is identical: declare, warn, sweep, then require.
 *
 * *** IT NEEDS NO EXTERNAL GATE, AND `REQUEST_CLASS_REQUIRED` DOES — THE DIFFERENCE IS WORTH
 * KNOWING. *** `requestClass` is validated by NOTHING this tool can execute (`0039`'s correction),
 * so requiring it would spread an unenforceable declaration across fifteen files with the
 * appearance of enforcement. **`enumPolicy` is validated by this generator on every run**, because
 * it decides the emitted type — declared, expressed AND executed. So its flip turns on the sweep
 * alone.
 */
const ENUM_POLICY_REQUIRED = false;

/**
 * *** `0041` EXTENDED TO `oneOf` VARIANT SETS. Team Lead ruling, 2026-09-09. ***
 *
 * `0041` governed `enum` — a set of scalar VALUES. `web-agent` attempted the `OrganizationDetail`
 * swap, the compiler refused it, **and it stopped instead of deleting what the compiler objected
 * to.** The finding it reported is the same question one construct along:
 *
 *   `RegistrationRecord` is a `oneOf` union of OBJECT SHAPES. It asks the identical open-or-closed
 *   question and there was no way to answer it.
 *
 * **The console had already answered it for itself, in all three layers** — `parseRegistrationRecord`
 * returns `{ state: 'unrecognised', raw: state }` for any state this build has never heard of, the
 * screen narrows on it, and it renders a visible panel quoting the raw value. **Adopting a bare
 * three-variant union deletes `raw`, turning that renderer into a compile error whose only fix
 * deletes a UI state the runtime still reaches** — `0037`'s trap, arriving as a tidy-up in a diff
 * that only deletes.
 *
 * So: same keyword, same two values, same meaning. `closed` emits the exact union; `extensible`
 * emits the variants **plus an explicit unknown-variant arm**.
 *
 * *** THE ARM'S SHAPE IS ADOPTED FROM THE CLIENT AND WAS NOT INVENTED HERE. *** The Team Lead's
 * instruction was explicit about the direction: the client was forced to solve this under a real
 * requirement while the contract was silent, so the contract takes the client's answer. Inventing a
 * second shape would have produced two spellings of one idea and a swap that still did not compile.
 *
 * ONE THING TO READ CAREFULLY, because the prose describing this ruling and the code implementing
 * it differ: the arm carries the raw DISCRIMINANT VALUE, not the raw PAYLOAD. That is deliberate
 * and it is the client's choice, not a simplification of it. A client meeting an unknown variant
 * cannot read that variant's sibling fields — it does not know their names, their types, or which
 * are required — so a `raw` holding the whole body would be an object nothing can narrow, offered
 * to a screen that must not act on it. The discriminant is the one thing that is always readable
 * and the only thing worth rendering: *"Core reported the state X, which is newer than this build."*
 */
const VARIANT_POLICY_REQUIRED = false;

/**
 * *** RESERVED PLATFORM-WIDE, `architecture.md` §1a, AND CHECKED RATHER THAN TRUSTED. ***
 *
 * The unknown arm has to spell its discriminant something, and whatever it spells is a value no
 * real variant may ever use — otherwise the day Core ships a state genuinely called `unrecognised`,
 * every client silently routes a REAL variant into the unknown branch and renders it as "newer than
 * this build". §1a's reasoning exactly: one name, two meanings, and no name collision to find,
 * because the collision is between a generated tag and a wire value.
 *
 * §1a also says to scope the reservation platform-wide rather than to the contracts that compose
 * with the mechanism today — a variant set is `closed` until someone changes it, and the scope
 * would move underneath the rule.
 *
 * `raw` is reserved on the same terms and for the same reason.
 *
 * **Both are ENFORCED BELOW, on every variant set, whatever its policy** — including `closed` ones,
 * because a `closed` set can be declared `extensible` later and the collision would arrive with the
 * declaration rather than with the offending value. A reservation that is documented and not
 * checked is `workflow.md`'s hole exactly one boolean wide.
 */
const UNKNOWN_VARIANT_TAG = 'unrecognised';
const UNKNOWN_VARIANT_PAYLOAD_FIELD = 'raw';

/**
 * The two declarations above must name the same three classes, checked at module load rather than
 * trusted — the house pattern (`assertRoleMappingIsCoherent`, `assertCriticalSetIsCoherent`).
 *
 * A class in `OPERATION_BLOCK_KEYS` with no shape vocabulary would make `shapeKeys` undefined and
 * throw mid-run on a real contract; a vocabulary no block key names would be dead configuration
 * that looks live. Neither is reachable now, and neither is something to remember.
 */
for (const key of OPERATION_BLOCK_KEYS) {
  if (SHAPE_KEYS_BY_CLASS[key] === undefined) {
    throw new Error(
      `OPERATION_BLOCK_KEYS names '${key}' and SHAPE_KEYS_BY_CLASS does not. Every accepted block key needs its class's request and response vocabulary.`,
    );
  }
}
for (const key of Object.keys(SHAPE_KEYS_BY_CLASS)) {
  if (!OPERATION_BLOCK_KEYS.includes(key)) {
    throw new Error(
      `SHAPE_KEYS_BY_CLASS names '${key}' and OPERATION_BLOCK_KEYS does not, so nothing can ever reach that vocabulary.`,
    );
  }
}
for (const [className, spec] of Object.entries(REQUEST_CLASSES)) {
  if (!OPERATION_BLOCK_KEYS.includes(spec.blockKey)) {
    throw new Error(
      `REQUEST_CLASSES['${className}'] expects block key '${spec.blockKey}', which OPERATION_BLOCK_KEYS does not accept. A declared class no contract could satisfy is worse than no class.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `fixtures` IS SKIPPED BY NAME AND THAT IS NOT WHAT KEEPS FIXTURES OUT OF THE CORPUS.
      //
      // Under `0040` the drift fixture lives in `packages/testing/**`, which this walk never
      // reaches — the corpus root is `packages/contracts/`. **The directory boundary is the
      // control; this name check is a leftover from when the fixture sat here.** It is kept
      // because it costs nothing and would still catch a fixture placed here by mistake, and it
      // is documented as a backstop so nobody reads it as the mechanism.
      //
      // *** IT WOULD NOT HAVE PREVENTED THE COLLISION IT LOOKS LIKE IT PREVENTS. *** Two fixture
      // trees under one root are separated by a `drift/` level, not by this list — `walk` skips
      // `fixtures` and `generated` by name and would happily descend into `drift/` or `cascade/`.
      if (entry === 'generated' || entry === 'node_modules' || entry === 'fixtures') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Finds every contract and its sibling schema.
 *
 * IT RETURNS THE INDEPENDENTLY DERIVED TOTALS ALONGSIDE THE PAIRS, and that is `workflow.md`
 * §11a rather than bookkeeping: "42 contracts read, 0 differences" and "the glob stopped matching"
 * render identically unless something outside the walk says how many there should have been.
 */
export function discoverContracts(root = CONTRACTS_ROOT) {
  const files = walk(root);
  const contractFiles = files.filter((f) => f.endsWith('.contract.yaml'));
  const schemaFiles = files.filter((f) => f.endsWith('.schema.json'));
  const pairs = contractFiles.map((contractPath) => ({
    contractPath,
    schemaPath: contractPath.replace(/\.contract\.yaml$/, '.schema.json'),
    name: contractPath.split(sep).pop().replace(/\.contract\.yaml$/, ''),
  }));
  return {
    pairs,
    totals: {
      contractFiles: contractFiles.length,
      schemaFiles: schemaFiles.length,
      // Schemas with no contract beside them — `common/**` and `registries/**`. Counted rather
      // than filtered silently, because "the number I expected" must be derived, not assumed.
      schemasWithoutContract: schemaFiles.filter(
        (s) => !contractFiles.includes(s.replace(/\.schema\.json$/, '.contract.yaml')),
      ).length,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Admission — `0037` requirement 2. THE PART A GENERAL-PURPOSE GENERATOR COULD NOT DO FOR US.
// ---------------------------------------------------------------------------------------------

/**
 * Refuses to emit for a contract missing a request shape, a response shape, error cases, an
 * authorization expectation or a tenant scope (`architecture.md` §1 — "a type alone is not a
 * contract").
 *
 * THIS TURNS A DOCUMENTATION GAP INTO A BUILD FAILURE, which is the whole argument for a
 * first-party generator over an off-the-shelf one.
 *
 * WHAT IT DOES *NOT* DO: judge whether the declared authorization is CORRECT, or whether the
 * tenancy section says anything true. It checks that the contract answers the question at all.
 * Naming which side that is about (`architecture.md` §3b): this is a check on the DOCUMENT, not
 * on the running system. A contract can pass every check here and be wrong about Core.
 */
export function admitContract(outline, { name }) {
  const errors = [];

  if (!outline.hasKey('tenancy')) {
    errors.push({
      code: GENERATOR_ERROR_CODES.MISSING_TENANT_SCOPE,
      contract: name,
      message:
        'No top-level `tenancy:` block. Every contract states its tenant scoping ' +
        '(architecture.md §1, §4). A contract that binds to no route still answers this — with ' +
        'the reason it has no tenant, which is what login-v1 and confirmation-v1 do in prose.',
    });
  }

  // ---- THE DECLARED REQUEST CLASS. `docs/decisions/0039`.
  const declaredClass = outline.scalar('requestClass');
  const warnings = [];
  if (declaredClass !== null && REQUEST_CLASSES[declaredClass] === undefined) {
    errors.push({
      code: GENERATOR_ERROR_CODES.UNKNOWN_REQUEST_CLASS,
      contract: name,
      message: `\`requestClass: ${declaredClass}\` is not one of ${Object.keys(REQUEST_CLASSES).map((c) => `\`${c}\``).join(', ')}. An unknown class is refused rather than ignored — an ignored declaration is worse than an absent one, because it looks like it was honoured.`,
    });
  }
  // *** THE MISSING-CLASS FINDING IS RAISED AFTER THE OPERATIONS ARE READ, NOT HERE. ***
  //
  // It used to fire on `declaredClass === null` at this point — a CONTRACT-LEVEL test, evaluated
  // before a single operation had been looked at. So `confirmation-v1`, whose two operations each
  // declare their own class and which therefore correctly has no contract-level value, was warned
  // about as though it declared nothing.
  //
  // **The classification honoured per-operation and the REPORTING did not**, which is the same
  // split that made the counter wrong: a fix applied to one reader of a fact and not to the others.
  // See the raise below the operations loop.

  const blockKey = OPERATION_BLOCK_KEYS.find((key) => outline.hasKey(key));

  // ---- THE EXPLICIT MARKER THE `NO_OPERATIONS_BLOCK` REFUSAL HAS ALWAYS DEMANDED AND NEVER OFFERED.
  //
  // That refusal's message says a contract deliberately publishing nothing "needs an explicit
  // marker rather than an absence" — **and no marker existed, so the only way to satisfy it was to
  // stop being that kind of contract.** A refusal naming a remedy the tool does not accept is a
  // refusal with no exit, and `account-identifier-v1` sat in it for every run.
  //
  // `publishesOperations: false` is that marker: a shared VOCABULARY contract, defining values
  // other contracts restate, binding to no route of its own.
  //
  // CHECKED AGAINST REALITY RATHER THAN TRUSTED. Declaring it while carrying an operations block
  // is a contradiction — the contract would be publishing routes under a marker saying it
  // publishes none — and is refused for the same reason a `requestClass` contradicting its block
  // key is refused: the generator will not guess which half is wrong.
  const declaresNoOperations = outline.scalar('publishesOperations') === 'false';
  if (declaresNoOperations && blockKey !== undefined) {
    errors.push({
      code: GENERATOR_ERROR_CODES.NO_OPERATIONS_BLOCK,
      contract: name,
      message: `declares \`publishesOperations: false\` and carries a \`${blockKey}:\` block. One of the two is wrong and the generator will not guess which.`,
    });
    return { ok: false, errors, warnings, operations: [], declaredClass, publishesOperations: true };
  }
  if (declaresNoOperations) {
    // Nothing to admit and nothing to refuse. Its `$defs` still emit — which is the point: this is
    // the contract that defines the canonical identifier every other one restates by hand.
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      operations: [],
      blockKey: undefined,
      declaredClass,
      publishesOperations: false,
    };
  }

  if (declaredClass !== null && REQUEST_CLASSES[declaredClass] !== undefined && blockKey !== undefined) {
    const expected = REQUEST_CLASSES[declaredClass].blockKey;

    // =========================================================================================
    // *** WHAT THIS CHECK ACTUALLY VERIFIES, AND IT IS NARROWER THAN `0039` CLAIMED. ***
    // =========================================================================================
    //
    // `0039` said the generator checks the declaration AGAINST THE ROUTE TABLES. **IT DOES NOT.
    // THIS FILE IMPORTS NO ROUTE TABLE.** It compares the declaration against the BLOCK KEY —
    // and `REQUEST_CLASSES` maps BOTH `session` AND `platform` to `operations:`, so for those two
    // it cannot distinguish them at all.
    //
    // `qa-agent` proved it by construction rather than by reading: one contract body, three
    // declarations — `session` ACCEPTED, `platform` ACCEPTED, `action` REFUSED. **The check
    // validates the declaration using the very signal `0039` established is unreliable.**
    //
    // SO THE AMBIGUOUS CASE IS REPORTED RATHER THAN SILENTLY PASSED. A declaration whose block key
    // is shared by more than one class is accepted AND announced as unverified, every run. That is
    // the `AUTHORIZATION_STANDARD` §4.1 lesson applied to this file: **a check that is scrupulous
    // about scope and silent about liveness is how "expressed" gets read as "enforced".**
    const sharing = Object.entries(REQUEST_CLASSES)
      .filter(([name_, spec]) => spec.blockKey === expected && name_ !== declaredClass)
      .map(([name_]) => name_);
    if (sharing.length > 0) {
      warnings.push({
        contract: name,
        message: `\`requestClass: ${declaredClass}\` is NOT VERIFIED by this generator. Its block key \`${expected}:\` is shared with ${sharing.map((s) => `\`${s}\``).join(', ')}, so declaring either passes. Only a comparison against the route tables can decide it, and this tool reads none — see 0039 and scripts/check-route-fields.mjs, which already reads both sides.`,
      });
    }

    if (expected !== blockKey) {
      // WHAT IT DOES CATCH: a declared class whose block key is wrong outright — `action` on an
      // `operations:` contract, or either shared class on an `actions:` one. Real, and narrow.
      // *** THE CONTRADICTION IS NO LONGER RAISED HERE. *** It is raised per operation, after the
      // loop, where the contract's full set of effective classes is known — because whether the
      // block key is evidence at all depends on whether the contract SPANS, and that cannot be
      // decided from the contract-level field alone. Leaving it here as well would double-report
      // one defect, which is the mirror of reporting a symptom instead of a cause.
    }
  }
  if (blockKey === undefined) {
    errors.push({
      code: GENERATOR_ERROR_CODES.NO_OPERATIONS_BLOCK,
      contract: name,
      message: `No ${OPERATION_BLOCK_KEYS.map((k) => `\`${k}:\``).join(', ')} block. A contract that publishes nothing cannot be generated from; if that is deliberate — a shared vocabulary contract such as account-identifier-v1 — it needs an explicit marker rather than an absence, because an absence is indistinguishable from an omission.`,
    });
    return { ok: false, errors, warnings, operations: [], declaredClass, publishesOperations: true };
  }

  const items = outline.items(blockKey);
  const operations = [];
  /** Operations with no effective class — their own, or the contract's. Phase 3 counts these. */
  let operationsLackingClass = 0;
  /** The distinct effective classes across this contract's operations. Size >= 2 means it SPANS. */
  const effectiveClasses = new Set();
  /** Per-operation record, so the block-key ruling below can be made once with all of them in hand. */
  const operationClasses = [];

  for (const item of items) {
    const id = item.fields.get('id');
    const where = `${name}:${item.line}${id === null || id === undefined ? '' : ` (${id})`}`;

    // PRESENCE, NOT VALUE. `has` rather than `get(k) != null` — see SHAPE_KEYS_BY_CLASS cause 2.
    // ---- PER-OPERATION `requestClass` WINS OVER THE CONTRACT-LEVEL ONE. `0039`.
    //
    // *** THE DEFECT THIS CLOSES WAS MINE, AND MY OWN COMMENT IS WHAT MADE IT LOOK HANDLED. ***
    // `confirmation-v1` publishes TWO operations in one `operations:` block —
    // `platform.confirmations.request` and `core.confirmations.request` — and I declared a single
    // contract-level `requestClass: platform`, with a note saying the Action-class route "carries
    // `requestClass: action` when it lands". **The note stops a person. It does not stop a tool
    // that reads the field**, and the field was asserting `platform` for an Action-class route.
    // `workflow.md` §12: prose describes, machine-readable fields instruct.
    const operationClass = item.fields.get('requestClass') ?? declaredClass;
    if (
      item.fields.has('requestClass') &&
      REQUEST_CLASSES[item.fields.get('requestClass')] === undefined
    ) {
      errors.push({
        code: GENERATOR_ERROR_CODES.UNKNOWN_REQUEST_CLASS,
        contract: name,
        operation: id,
        message: `${where}: \`requestClass: ${item.fields.get('requestClass')}\` is not one of ${Object.keys(REQUEST_CLASSES).map((c) => `\`${c}\``).join(', ')}.`,
      });
    }
    if (operationClass === null || operationClass === undefined) operationsLackingClass += 1;
    else effectiveClasses.add(operationClass);
    operationClasses.push({ id, where, operationClass, declaredOwn: item.fields.has('requestClass') });

    // THE BLOCK-KEY CHECK IS DELIBERATELY NOT APPLIED TO AN OPERATION THAT DECLARES ITS OWN CLASS.
    // A contract spanning classes cannot have one block key matching all of them — `0039` allows
    // the per-operation form for exactly that case — so the block key is not evidence about such an
    // operation. **What IS evidence is `scripts/check-request-class.mjs`, which compares the
    // declaration against the registry Core actually registers the route in.** The local heuristic
    // defers to the real check rather than manufacturing a contradiction with it.

    const shapeKeys = SHAPE_KEYS_BY_CLASS[blockKey];
    const requestKey = shapeKeys.request.find((k) => item.fields.has(k));
    const responseKey = shapeKeys.response.find((k) => item.fields.has(k));
    const errorsRaw = item.fields.get('errors');
    const permission = item.fields.get('permission');

    if (requestKey === undefined) {
      errors.push({
        code: GENERATOR_ERROR_CODES.MISSING_REQUEST_SHAPE,
        contract: name,
        operation: id,
        message: `${where}: no ${shapeKeys.request.map((k) => `\`${k}:\``).join(' or ')} — the request-shape keys a \`${blockKey}:\` block may use.`,
      });
    }
    if (responseKey === undefined) {
      errors.push({
        code: GENERATOR_ERROR_CODES.MISSING_RESPONSE_SHAPE,
        contract: name,
        operation: id,
        message: `${where}: no ${shapeKeys.response.map((k) => `\`${k}:\``).join(' or ')} — the response-shape keys a \`${blockKey}:\` block may use.`,
      });
    }
    if (errorsRaw == null) {
      errors.push({
        code: GENERATOR_ERROR_CODES.MISSING_ERROR_CASES,
        contract: name,
        operation: id,
        message: `${where}: no \`errors:\` list. "The error cases" is one of the five things a contract is (architecture.md §1).`,
      });
    }
    if (permission == null) {
      // *** THE ONE REFUSAL MOST LIKELY TO BE ARGUED WITH, SO THE ARGUMENT IS HERE. ***
      // A pre-authentication entry point (`0014` §B) and a session-class route (`0021`) evaluate
      // NO permission, legitimately. They are still required to SAY SO. `permission-catalog.yaml`
      // already makes this exact distinction normative — "A ROUTE WITH NO DECLARED PERMISSION IS
      // UNREACHABLE, NOT OPEN — UNLESS it is registered in one of TWO closed, Core-owned,
      // enumerated sets" — and an absent key cannot be distinguished from a forgotten one.
      // The fix is a declared `permission: none` with the registry named, NOT a softer check.
      errors.push({
        code: GENERATOR_ERROR_CODES.MISSING_AUTHORIZATION,
        contract: name,
        operation: id,
        message: `${where}: no \`permission:\`. If this route legitimately evaluates none — a PreAuthEntryPoint (0014 §B) or the session class (0021) — it must SAY so explicitly, because an absent key and a forgotten one are the same character.`,
      });
    }

    operations.push({
      id,
      line: item.line,
      requestKey,
      responseKey,
      requestValue: requestKey === undefined ? null : item.fields.get(requestKey),
      responseValue: responseKey === undefined ? null : item.fields.get(responseKey),
      errorsRaw,
      permission,
    });
  }

  // ---- THE MISSING-CLASS FINDING, raised per contract but decided per OPERATION.
  if (operationsLackingClass > 0) {
    const entry = {
      code: GENERATOR_ERROR_CODES.MISSING_REQUEST_CLASS,
      contract: name,
      message: `${operationsLackingClass} of ${operationClasses.length} published operation(s) have no \`requestClass:\` — their own or the contract's. 0039 requires it because four classes share three block keys and \`operations:\` covers two of them, so the class cannot be inferred. Phase 1: warning, and the shape vocabulary falls back to the block key.`,
    };
    if (REQUEST_CLASS_REQUIRED) errors.push(entry);
    else warnings.push(entry);
  }

  // ---- THE BLOCK-KEY CHECK, NARROWED RATHER THAN SKIPPED. Team Lead ruling, 2026-09-09.
  //
  // *** THE FIRST VERSION SKIPPED IT FOR ANY OPERATION THAT DECLARED ITS OWN CLASS, AND THAT WAS
  // TOO WIDE BY 14 CONTRACTS. *** It was introduced for the genuine spanning case —
  // `confirmation-v1`, whose Action-class challenge sits in an `operations:` block — and then
  // applied to every per-operation declaration, including the 14 contracts where the block key is
  // still perfectly good evidence.
  //
  // **AND THE HOLE LANDED EXACTLY ON THE OPERATION IT WAS INTRODUCED FOR.** I reported it as
  // covered by `scripts/check-request-class.mjs`; that check compares a declaration against the
  // registry Core registers the route in, and `core.confirmations.request` **is not registered** —
  // it is NEW WORK. So its output is *"UNCHECKED, NOT AGREED"*. **My check skipped it because the
  // contract spans; that one cannot reach it because the route does not exist. The intersection is
  // empty on the one operation that motivated the skip.** Naming a collector who cannot collect is
  // weaker than naming none.
  //
  // So: the check applies whenever the contract resolves to ONE class, and a genuinely spanning
  // contract gets a PRINTED LINE rather than silence — `0039`'s own honest-fallback pattern, where
  // an unverifiable declaration announces itself instead of passing quietly.
  if (blockKey !== undefined) {
    const spans = effectiveClasses.size >= 2;
    for (const op of operationClasses) {
      if (op.operationClass === null || op.operationClass === undefined) continue;
      const spec = REQUEST_CLASSES[op.operationClass];
      if (spec === undefined || spec.blockKey === blockKey) continue;
      if (spans) {
        warnings.push({
          contract: name,
          message: `${op.where}: declares \`requestClass: ${op.operationClass}\` (${spec.record}), whose block key is \`${spec.blockKey}:\`, inside this contract's \`${blockKey}:\` block. THAT IS LEGITIMATE — this contract spans ${[...effectiveClasses].map((c) => `\`${c}\``).join(' and ')} and one block key cannot match both (0039). *** NOTHING VERIFIES THIS DECLARATION. *** scripts/check-request-class.mjs compares against the registry Core registers the route in, and this route is not registered yet, so it reports UNCHECKED rather than agreement. The declaration becomes checkable the day the route lands.`,
        });
      } else {
        errors.push({
          code: GENERATOR_ERROR_CODES.REQUEST_CLASS_CONTRADICTS_BLOCK,
          contract: name,
          operation: op.id,
          message: `${op.where}: \`requestClass: ${op.operationClass}\` (${spec.record}) expects a \`${spec.blockKey}:\` block and this contract uses \`${blockKey}:\`. This contract resolves to ONE class, so the block key is evidence and it disagrees. One of the two is wrong and the generator will not guess which.`,
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    operations,
    blockKey,
    declaredClass,
    publishesOperations: true,
    spansClasses: effectiveClasses.size >= 2,
    // *** THE COUNT PHASE 3 NEEDS IS PER OPERATION, NOT PER CONTRACT. ***
    // A contract with a contract-level class and one operation overriding it is fully declared; a
    // contract with a class and an operation the class does not fit is not. Counting contracts
    // would call both of those "declared" and miss the second entirely.
    fullyDeclared: operationsLackingClass === 0,
    operationsLackingClass,
  };
}

// ---------------------------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------------------------

function pascalCase(name) {
  return name
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

function quoteLiteral(value) {
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * ===========================================================================================
 * TWO ENUMERATED LISTS, AND ANYTHING IN NEITHER IS REFUSED. `qa-agent`'s finding, 2026-09-09.
 * ===========================================================================================
 *
 * *** THE DEFECT THIS REPLACES WAS FAIL-OPEN ON LIVE CONTENT, AND IT IS THE WORST ONE FOUND. ***
 *
 * The first version keyed on the ABSENCE of nine shape keywords, on the reasoning that "a
 * constraint this generator has never seen is treated as a constraint rather than as an error."
 * **Four shape-bearing keywords were missing from that list** — a schema-valued
 * `additionalProperties`, `patternProperties`, `prefixItems`, and `if`/`then`/`else` — so a node
 * carrying one was classified as a constraint and DROPPED.
 *
 * **AND THE OUTCOME DEPENDED ON WHERE THE NODE SAT:**
 *
 *   standalone `$def`          -> REFUSED, correctly, by `renderType`'s default branch
 *   inside `allOf`/`oneOf`     -> WARNED AND SILENTLY DROPPED, with the warning then asserting
 *                                 "members carry only constraints", which was FALSE of that node
 *
 * **Same keyword, same file, opposite answer by nesting depth.** `renderType`'s own doctrine is
 * that it returns a refusal rather than `unknown`, because `unknown` *"silently means the
 * generator did not understand this"*. Inside a combinator it returned **neither** — it returned a
 * confidently wrong type, which is worse than both.
 *
 * **It is live content, not a hypothetical.** `common/error-envelope.schema.json` carries an
 * `allOf` member with `if`/`else` — the presence rule for `retry_after_seconds`, whose own
 * description records that a retry time beside `not_found` *"would be a channel"*. On the
 * fail-open path that rule was dropped and **the emitted type would permit exactly the
 * combination the contract forbids.** It was latent only because the shared closure was emitting
 * nothing; the closure exists to start emitting that file.
 *
 * **WHY TWO LISTS RATHER THAN A LONGER SHAPE LIST.** Completing one list is a discipline, and it
 * is short again the next time JSON Schema grows or the corpus reaches for a keyword nobody
 * enumerated. With two lists, an unrecognised keyword falls into neither and **fails closed and
 * loudly** — which is the property that surfaced all three real findings at the boundary rather
 * than in a consumer.
 */
const SHAPE_KEYWORDS = Object.freeze([
  // `enumPolicy` is OURS, not JSON Schema's, and it is SHAPE-bearing rather than an annotation:
  // it decides whether the emitted union is closed or carries an unknown arm (`0041`). Listing it
  // as a constraint would make an enum node classify as constraint-only and be dropped inside a
  // combinator — the fail-open path this classifier was rebuilt to close.
  'enumPolicy',
  'type', 'enum', 'const', '$ref', 'properties', 'items', 'oneOf', 'anyOf', 'allOf',
  'patternProperties', 'prefixItems', 'if', 'then', 'else', 'not', 'contains',
  'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'dependentSchemas',
]);

const CONSTRAINT_KEYWORDS = Object.freeze([
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'uniqueItems', 'minContains', 'maxContains',
  'minProperties', 'maxProperties', 'required', 'dependentRequired',
  'contentEncoding', 'contentMediaType',
  // Annotations. They describe and never instruct, so they cannot make a node shape-bearing.
  'title', 'description', '$comment', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
  // `enumPolicyDivergence` is OURS and belongs HERE rather than beside `enumPolicy` in SHAPE, which
  // is the distinction worth stating because the two names look like a pair. `enumPolicy` DECIDES
  // THE EMITTED TYPE — closed union or union plus unknown arm — so it is shape-bearing. This one
  // decides NOTHING about the type: it is a declared exemption from the duplicate-policy CHECK,
  // naming the counterpart def whose identical value set legitimately carries the opposite policy
  // (0041 amendment 1: a request enum is always `closed`, a response enum may be `extensible`).
  // Listing it as shape would make a node carrying only it classify as shape-bearing and render as
  // a type, which it is not. It never appears without an `enum` beside it, so it cannot make a node
  // constraint-only either.
  'enumPolicyDivergence',
  // Document furniture, harmless wherever it appears.
  '$schema', '$id', '$defs', '$anchor',
]);

/**
 * The two lists must be disjoint, checked at module load in the house style
 * (`assertRoleMappingIsCoherent`). A keyword in both would make classification depend on which
 * list happened to be consulted first — the positional ambiguity this whole mechanism replaces.
 */
{
  const overlap = SHAPE_KEYWORDS.filter((k) => CONSTRAINT_KEYWORDS.includes(k));
  if (overlap.length > 0) {
    throw new Error(
      `SHAPE_KEYWORDS and CONSTRAINT_KEYWORDS both contain: ${overlap.join(', ')}. A keyword in both lists makes classification order-dependent.`,
    );
  }
}

/**
 * `'shape'` — describes a type · `'constraint'` — describes only a restriction on one ·
 * `'unclassified'` — a keyword in neither list, which is REFUSED wherever it appears.
 *
 * `additionalProperties` is classified BY ITS VALUE: `false` (or `true`) is a constraint, a
 * schema object is shape. That is the one keyword whose kind is not decidable from its name.
 */
function classifyNode(node) {
  if (node === null || typeof node !== 'object') return 'unclassified';
  const unknown = [];
  let shape = false;
  for (const key of Object.keys(node)) {
    if (key === 'additionalProperties') {
      if (node[key] !== null && typeof node[key] === 'object') shape = true;
      continue;
    }
    if (SHAPE_KEYWORDS.includes(key)) shape = true;
    else if (!CONSTRAINT_KEYWORDS.includes(key)) unknown.push(key);
  }
  if (unknown.length > 0) return 'unclassified';
  return shape ? 'shape' : 'constraint';
}

/** Kept as a named predicate because the combinator filters read better with it. */
function isConstraintOnly(node) {
  return classifyNode(node) === 'constraint';
}

/**
 * ===========================================================================================
 * CLASSIFYING A `oneOf`, AND THE SKIP-SET IS ENUMERATED RATHER THAN DEFAULTED
 * ===========================================================================================
 *
 * `0041` extended to variant sets (see `VARIANT_POLICY_REQUIRED`) requires a policy on a `oneOf`
 * that is a discriminated union of object shapes. **It must NOT require one on the other kinds**,
 * and the corpus is 35 `oneOf`s of which 31 are nullable wrappers — `{ oneOf: [{$ref}, {type:
 * null}]}` — where "is this union open or closed" is not a question anyone can answer.
 *
 * *** SO THIS FUNCTION IS A SKIP-SET, WHICH `workflow.md` §11a NAMES AS THE AXIS AN AUTHOR CANNOT
 * SEE, AND IT IS WRITTEN THE ONLY WAY THAT MITIGATES THAT: EVERY OUTCOME IS NAMED AND COUNTED. ***
 * There is no `else return`. A `oneOf` this generator cannot place lands in a named bucket that
 * appears in the population report, so "the requirement reached nothing" and "the requirement
 * reached everything and found nothing wrong" cannot render the same way.
 *
 * THE SIX OUTCOMES:
 *
 *   `constraint-alternation`   every member is constraint-only — exactly-one-of expressed with
 *                              `required` and nothing else. No type union is emitted at all; the
 *                              parent's own `type` is the answer. Nothing to declare.
 *   `nullable`                 exactly two members, exactly one of which is a bare `type: null`.
 *                              `T | null` has no discriminant and no unknown variant to carry.
 *   `variant-set`              every member is an object shape sharing exactly one string-valued
 *                              discriminant with pairwise-disjoint values. *** POLICY REQUIRED. ***
 *   `scalar-or-mixed`          members that are not all object shapes — a union of scalar types,
 *                              or a mix. Renders as today. No discriminant exists to tag.
 *   `undiscriminated-object`   *** REFUSED. *** Every member is an object shape and NOTHING tells
 *                              them apart. This is the dangerous one and it is why the negative
 *                              branch is a refusal rather than a shrug: such a union emits a closed
 *                              type a client cannot narrow, `0041` cannot be declared on it, and
 *                              there is no field an unknown arm could carry. It is a contract
 *                              defect, and the corpus has none today.
 *   `ambiguous-discriminant`   *** REFUSED. *** Two or more properties could be the discriminant.
 *                              Picking one would be a silently wrong subject; the file's own
 *                              doctrine for a shape-search is EXACTLY ONE match or a loud
 *                              ambiguity, and this is that rule applied to a property name.
 *
 * WHY A DISCRIMINANT MUST BE STRING-VALUED, since it reads like an arbitrary narrowing: the unknown
 * arm tags itself `'unrecognised'`, which is a string. A union discriminated on `const: 1` has no
 * way to spell an unknown arm at all, so admitting it would produce a variant set that can be
 * declared `extensible` and cannot honour it.
 *
 * IT ALSO DROPS A REAL FALSE POSITIVE, MEASURED RATHER THAN ANTICIPATED. `capability-manifest`'s
 * root union carries `manifestVersion: {const: 1}` in BOTH members alongside `kind`. Two shared
 * `const` properties is exactly the ambiguity above — except `manifestVersion` is a number and its
 * value is IDENTICAL in both members, so it fails on two independent clauses and `kind` is the sole
 * candidate. **Both clauses were needed and neither is decorative.**
 */
function isBareNull(node) {
  if (node === null || typeof node !== 'object') return false;
  if (node.type !== 'null') return false;
  return Object.keys(node).every((k) => k === 'type' || CONSTRAINT_KEYWORDS.includes(k));
}

function isObjectShape(node) {
  if (node === null || typeof node !== 'object') return false;
  return node.type === 'object' || node.properties !== undefined;
}

/**
 * Follows a LOCAL `$ref` exactly one hop, because three of the four variant sets in this corpus
 * name their members by reference rather than inlining them. One hop and no further: a chain would
 * need cycle detection for a case nothing in the corpus has, and a `$ref` that resolves to another
 * `$ref` returns that node, which then fails `isObjectShape` and lands in `scalar-or-mixed` —
 * reported, not silently mistaken for a variant set.
 *
 * A CROSS-FILE `urn:` REFERENCE IS DELIBERATELY NOT FOLLOWED and returns `undefined`. Following it
 * would make one contract's variant classification depend on another file's contents, so a schema
 * could stop being a variant set because a DIFFERENT contract was edited. Nothing in the corpus
 * needs it; if something ever does, the honest failure is the `scalar-or-mixed` bucket appearing in
 * the report with a count nobody expected.
 */
function resolveLocalDefOneHop(node, ctx) {
  if (node === null || typeof node !== 'object') return undefined;
  if (typeof node.$ref !== 'string') return node;
  const local = /^#(\/.+)$/.exec(node.$ref);
  if (local === null) return undefined;
  return resolvePointer(ctx.schemaRoot, local[1]);
}

/** The string values a discriminant subschema admits, or `undefined` if it cannot be one. */
function discriminantValues(node, ctx) {
  const resolved = resolveLocalDefOneHop(node, ctx);
  if (resolved === null || typeof resolved !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(resolved, 'const')) {
    return typeof resolved.const === 'string' ? [resolved.const] : undefined;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0 && resolved.enum.every((v) => typeof v === 'string')) {
    return resolved.enum.slice();
  }
  return undefined;
}

/**
 * Every outcome `classifyOneOf` can return, in one list, so the population report can print all of
 * them including the zeroes. A kind that is never printed when its count is zero is a kind nobody
 * notices stopped happening.
 */
const ONEOF_KINDS = Object.freeze([
  'variant-set',
  'nullable',
  'constraint-alternation',
  'scalar-or-mixed',
  'undiscriminated-object',
  'ambiguous-discriminant',
]);

const newOneOfKindCounts = () => Object.fromEntries(ONEOF_KINDS.map((k) => [k, 0]));

/**
 * ONE MERGE, TWO CALL SITES. The contract loop and the shared-closure loop both fold a module's
 * counters into the report's, and they were two hand-written pairs of `+=` lines. A counter added
 * to one and not the other is the half-wired mechanism this file has already been bitten by —
 * *"making a mechanism single is not the same as making it correct"*, and the way to make it
 * correct is that there is only one place to forget.
 */
function mergeEmittedPopulation(into, from) {
  into.enumsExamined += from.enumsExamined;
  into.enumsLackingPolicy += from.enumsLackingPolicy;
  into.variantSetsExamined += from.variantSetsExamined;
  into.variantSetsLackingPolicy += from.variantSetsLackingPolicy;
  for (const kind of ONEOF_KINDS) into.oneOfsByKind[kind] += from.oneOfsByKind[kind];
}

function classifyOneOf(members, ctx) {
  if (members.length === 0) return { kind: 'scalar-or-mixed' };
  if (members.every((m) => isConstraintOnly(m))) return { kind: 'constraint-alternation' };
  if (members.length === 2 && members.filter(isBareNull).length === 1) return { kind: 'nullable' };

  const resolved = members.map((m) => resolveLocalDefOneHop(m, ctx));
  if (!resolved.every(isObjectShape)) return { kind: 'scalar-or-mixed' };

  const firstProps = resolved[0].properties ?? {};
  const shared = Object.keys(firstProps).filter((name) =>
    resolved.every((r) => Object.prototype.hasOwnProperty.call(r.properties ?? {}, name)),
  );

  const candidates = [];
  for (const name of shared) {
    const valueSets = resolved.map((r) => discriminantValues(r.properties[name], ctx));
    if (valueSets.some((v) => v === undefined)) continue;
    const seen = new Set();
    let disjoint = true;
    for (const set of valueSets) {
      for (const v of set) {
        if (seen.has(v)) { disjoint = false; break; }
        seen.add(v);
      }
      if (!disjoint) break;
    }
    if (disjoint) candidates.push({ name, valueSets });
  }

  if (candidates.length === 0) return { kind: 'undiscriminated-object', shared };
  if (candidates.length > 1) return { kind: 'ambiguous-discriminant', names: candidates.map((c) => c.name) };
  return {
    kind: 'variant-set',
    discriminant: candidates[0].name,
    valueSets: candidates[0].valueSets,
    resolved,
  };
}

/** Resolves a JSON Pointer fragment (`/$defs/a/properties/b`) against a parsed document. */
function resolvePointer(doc, pointer) {
  const parts = pointer.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = doc;
  for (const part of parts) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, part)) {
      return undefined;
    }
    node = node[part];
  }
  return node;
}

/**
 * Renders one JSON Schema node as a TypeScript type expression.
 *
 * FAILS CLOSED ON ANYTHING IT DOES NOT RECOGNISE. It returns a refusal rather than `unknown`,
 * because `unknown` is a type that compiles, passes review, and silently means "the generator did
 * not understand this" — which is exactly the plausible-but-wrong output `0037` warns about.
 */
function renderType(node, ctx, path) {
  if (node === null || typeof node !== 'object') {
    ctx.errors.push({
      code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
      contract: ctx.contractName,
      message: `${path}: not a schema object.`,
    });
    return 'never';
  }

  if (typeof node.$ref === 'string') {
    // ===========================================================================================
    // *** A `$ref` CARRYING A SHAPE-BEARING SIBLING IS REFUSED. ***
    // ===========================================================================================
    //
    // Since draft 2019-09, `$ref` is NOT exclusive: `{"$ref": X, "type": "object"}` is legal and
    // means "matches X **and** is an object" — an INTERSECTION. The correct rendering is `X & {…}`
    // and this generator does not implement it: the line below returns `X` alone and **silently
    // drops every sibling.** That is the confidently-wrong output this file refuses everywhere
    // else, arriving through the one keyword that looked like it could not have siblings.
    //
    // FOUND BY ANSWERING A NARROWER QUESTION. `qa-agent` constructed a root carrying `$ref` AND
    // `type` and got a DUPLICATE `ErrorEnvelope` with no refusal — failing closed only at `tsc`,
    // a different gate from the one that produced it. The proposal was to refuse a `$ref` root.
    // **The root is where it was observed and not where it lives:** any `$ref` with a shape-bearing
    // sibling, at any depth, drops it the same way.
    //
    // ANNOTATIONS AND DOCUMENT FURNITURE ARE NOT SIBLINGS IN THIS SENSE — `description`, `$comment`,
    // `$defs`, `$id`, `$schema` do not change a type, and every `$ref` in the corpus carries some
    // of them. The classifier's own lists decide which is which, so this refusal cannot drift away
    // from `classifyNode`'s idea of shape.
    const shapeSiblings = Object.keys(node).filter(
      (k) =>
        k !== '$ref' &&
        (SHAPE_KEYWORDS.includes(k) ||
          (k === 'additionalProperties' && node[k] !== null && typeof node[k] === 'object')),
    );
    if (shapeSiblings.length > 0) {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
        contract: ctx.contractName,
        message: `${path}: a \`$ref\` alongside shape-bearing sibling(s) [${shapeSiblings.join(', ')}]. Draft 2020-12 makes that an INTERSECTION; this generator would emit only the reference and silently drop the rest. Express it as an \`allOf\` of the reference and the extra shape, which renders as the intersection it is.`,
      });
      return 'never';
    }
    return renderRef(node.$ref, ctx, path);
  }

  if (Array.isArray(node.enum)) {
    ctx.population.enumsExamined += 1;
    // =========================================================================================
    // *** EVERY ENUM DECLARES `closed` OR `extensible`. UNDECLARED IS REFUSED. `docs/decisions/0041`.
    // =========================================================================================
    //
    // THE COLLISION THAT PRODUCED THE RULE, found on the first real type swap rather than in
    // principle: `template-v1`'s `status` is a two-value enum, so this generator emitted a
    // two-value union — while the client's parser reads it with `requireString` and the screen
    // renders an unrecognised value NEUTRALLY, ON PURPOSE. Adopting the union unchanged makes that
    // tolerant branch dead code by the type system's reckoning, **which is how the next person
    // deletes it**, while the runtime can still produce the case.
    //
    // > **A client cannot be tolerant at runtime and narrow at compile time without one of the two
    // > lying.**
    //
    // NEITHER SINGLE ANSWER WORKS, AND TWO LIVE CASES ARE WHY. All-closed is right for
    // `errorCode` — whose partition `qa-agent` asserts, and where adding a code SHOULD be a
    // decision — and wrong for a lifecycle status, where it makes every new state a version bump
    // and invites someone to widen the client instead, which is `0034` exactly. All-extensible
    // would silently gut the error envelope's discriminated union, whose entire value is that the
    // compiler refuses the forbidden combination.
    const policy = node.enumPolicy;
    if (policy === undefined) {
      // ---- PHASE 1: WARN, DO NOT REFUSE. See ENUM_POLICY_REQUIRED for why and for the flip.
      const entry = {
        code: GENERATOR_ERROR_CODES.MISSING_ENUM_POLICY,
        contract: ctx.contractName,
        message: `${path}: an \`enum\` with no \`enumPolicy\`. Declare \`closed\` (adding a value is BREAKING; the parser must reject an unlisted one) or \`extensible\` (the server may send a value this client has never seen; the parser must NOT reject it). An absence is not a default — an absent declaration and a forgotten one are the same character.`,
      };
      if (ENUM_POLICY_REQUIRED) {
        ctx.errors.push(entry);
        return 'never';
      }
      ctx.warnings.push(entry);
      ctx.population.enumsLackingPolicy += 1;

      // *** THE UNMIGRATED DEFAULT IS TODAY'S OUTPUT — THE EXACT UNION — AND THAT IS DELIBERATE.
      //
      // Emitting the `extensible` form here would be safer in principle and WORSE in practice: it
      // would change the emitted type of every enum in the corpus **while `web-agent` is
      // mid-conversion against those very types**, and change every committed module, which the
      // drift check would then report as drift.
      //
      // **A new requirement must not alter what existing consumers already compile against.** So
      // phase 1 preserves the current behaviour exactly — INCLUDING the defect `0041` was written
      // about, which persists for one more pass by choice rather than by oversight. The sweep is
      // the fix; a silent type change under a consumer would be a second defect bought to hide the
      // first one a few days earlier.
      return node.enum.map((v) => (v === null ? 'null' : quoteLiteral(v))).join(' | ');
    }
    if (policy !== 'closed' && policy !== 'extensible') {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNKNOWN_ENUM_POLICY,
        contract: ctx.contractName,
        message: `${path}: \`enumPolicy: ${policy}\` is not \`closed\` or \`extensible\`. Refused rather than ignored — an ignored declaration is worse than an absent one, because it looks like it was honoured.`,
      });
      return 'never';
    }

    const members = node.enum.map((v) => (v === null ? 'null' : quoteLiteral(v))).join(' | ');
    if (policy === 'closed') return members;

    // ---- THE UNKNOWN ARM. `(string & {})` IS DELIBERATE AND MUST NOT BE "SIMPLIFIED".
    //
    // It is the TypeScript idiom for *these values, plus any other string* — it keeps the known
    // members visible to autocomplete and to a reader while accepting a value the server added
    // after this file was generated.
    //
    // **DO NOT replace it with `string`:** that deletes the known values, and the whole point of
    // `extensible` is that a client can still branch on the ones it knows.
    // **DO NOT delete the arm:** that makes the union closed, which is the defect `0041` exists to
    // stop — a compile-time claim stronger than the runtime check beneath it.
    return `${members} | (string & {})`;
  }
  if (Object.prototype.hasOwnProperty.call(node, 'const')) {
    return node.const === null ? 'null' : quoteLiteral(node.const);
  }

  // ---- CONSTRAINT-ONLY SUBSCHEMAS CONTRIBUTE NOTHING TO A TYPE, AND THE PARENT IS THE ANSWER.
  //
  // Added 2026-09-09 after the first run refused two real contracts. `customer-directory-v1`'s
  // `phone` carries `allOf: [{minLength}, {maxLength}]` with the `type` on the parent — idiomatic
  // JSON Schema with nothing a TypeScript type can express, because `minLength` is a runtime
  // constraint rather than a shape.
  //
  // *** THE SECOND EXAMPLE THIS COMMENT CITED NO LONGER EXISTS, AND THE CORRECTION IS THE POINT. ***
  // It named `organization-detail-v1`'s `resolveMemberInput` as carrying
  // `oneOf: [{required:[a]}, {required:[b]}]` — an exactly-one-of over two identifier fields.
  // **`0034` phase 3 removed `identifier`**, leaving `required: ["target_identifier"]` and no
  // alternation at all, so that file now holds exactly one `oneOf` and it is a nullable wrapper on
  // `template`. `architecture.md` §3c: a comment that cites a contract is a claim about that
  // contract, and this one went false when the contract was repaired rather than when it was
  // written. The `allOf` example above is live and was checked; the count is derived from the file.
  //
  // THE OLD BEHAVIOUR WAS TO REFUSE, WHICH WAS RIGHT AS A DEFAULT AND WRONG HERE. A refusal that
  // fires on valid, common input stops the generator serving the corpus it was built for. It was
  // still the correct FIRST behaviour: it failed loudly rather than emitting `unknown`, which is
  // how these two were found at all.
  // ---- COMBINATORS. ONE CLASSIFIER, ONE ANSWER, WHEREVER THE NODE SITS.
  //
  // The positional asymmetry is gone: a member is classified by `classifyNode` exactly as a
  // standalone `$def` is, so `if`/`then`/`else` refuses in both positions and an unrecognised
  // keyword refuses in both. **A rule whose outcome depends on nesting depth is a rule nobody can
  // hold in their head, and it is how the previous one hid.**
  // ---- `oneOf` VARIANT SETS. `0041` EXTENDED, Team Lead ruling 2026-09-09.
  //
  // Sits BEFORE the general combinator loop so that a variant set is decided here and everything
  // else falls through to the behaviour that was already there, byte for byte. The unclassified-
  // member refusal is repeated at the top rather than shared, because this branch returns before
  // the loop can run it and a `oneOf` carrying an unrecognised keyword must refuse in both paths —
  // the positional asymmetry that hid the last fail-open defect in this file.
  if (Array.isArray(node.oneOf)) {
    const unclassifiedMembers = node.oneOf
      .map((sub, i) => ({ sub, i }))
      .filter(({ sub }) => classifyNode(sub) === 'unclassified');
    if (unclassifiedMembers.length > 0) {
      for (const { i } of unclassifiedMembers) {
        ctx.errors.push({
          code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
          contract: ctx.contractName,
          message: `${path}/oneOf/${i}: carries a keyword in neither SHAPE_KEYWORDS nor CONSTRAINT_KEYWORDS. Refused rather than assumed to be a constraint — the assumption dropped an \`if\`/\`else\` presence rule from a live contract and emitted a type permitting what the contract forbids.`,
        });
      }
      return 'never';
    }

    const shape = classifyOneOf(node.oneOf, ctx);
    ctx.population.oneOfsByKind[shape.kind] += 1;

    if (shape.kind === 'undiscriminated-object') {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNDISCRIMINATED_VARIANT_UNION,
        contract: ctx.contractName,
        message: `${path}: a \`oneOf\` in which every member is an object shape and NOTHING distinguishes them — no property present in all members carries a string \`const\` or \`enum\` with values disjoint across the members${shape.shared.length > 0 ? ` (shared properties: ${shape.shared.join(', ')})` : ' (the members share no property at all)'}. A client cannot narrow such a union, \`0041\` cannot be declared on it, and an unknown-variant arm would have no field to tag itself with. Give the members a discriminant property.`,
      });
      return 'never';
    }

    if (shape.kind === 'ambiguous-discriminant') {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.AMBIGUOUS_VARIANT_DISCRIMINANT,
        contract: ctx.contractName,
        message: `${path}: ${shape.names.length} properties could each be this union's discriminant [${shape.names.join(', ')}]. Refused rather than resolved by position or by name — choosing one would make the emitted type depend on a rule nobody stated, and the unknown-variant arm would tag the wrong field. Narrow it so exactly one property discriminates.`,
      });
      return 'never';
    }

    if (shape.kind === 'variant-set') {
      ctx.population.variantSetsExamined += 1;

      // ---- THE RESERVED NAMES, CHECKED ON EVERY VARIANT SET WHATEVER ITS POLICY.
      //
      // Deliberately NOT scoped to `extensible` sets. A `closed` set can be redeclared later, and
      // the collision would then arrive with the declaration rather than with the offending value —
      // which is the failure that is hardest to attribute, because the file that broke is not the
      // file that changed.
      const collidingTag = shape.valueSets.flat().includes(UNKNOWN_VARIANT_TAG);
      const collidingField = shape.resolved.some((r) =>
        Object.prototype.hasOwnProperty.call(r.properties ?? {}, UNKNOWN_VARIANT_PAYLOAD_FIELD),
      );
      if (collidingTag || collidingField) {
        ctx.errors.push({
          code: GENERATOR_ERROR_CODES.RESERVED_VARIANT_NAME,
          contract: ctx.contractName,
          message: `${path}: ${collidingTag ? `a variant's \`${shape.discriminant}\` is the reserved value \`${UNKNOWN_VARIANT_TAG}\`` : `a variant declares the reserved property \`${UNKNOWN_VARIANT_PAYLOAD_FIELD}\``}. Both names are reserved platform-wide for the unknown-variant arm (architecture.md §1a). A real variant using either would be routed into the unknown branch by every client and rendered as "newer than this build" — one name, two meanings, and no name collision for a reviewer to find because the collision is between a generated tag and a wire value.`,
        });
        return 'never';
      }

      const rendered = node.oneOf
        .map((sub, i) => renderType(sub, ctx, `${path}/oneOf/${i}`))
        .join(' | ');

      const policy = node.enumPolicy;
      if (policy === undefined) {
        const entry = {
          code: GENERATOR_ERROR_CODES.MISSING_VARIANT_POLICY,
          contract: ctx.contractName,
          message: `${path}: a \`oneOf\` variant set discriminated on \`${shape.discriminant}\` with no \`enumPolicy\`. Declare \`closed\` (a new variant is BREAKING; the parser must reject an unknown discriminant) or \`extensible\` (the server may send a variant this client has never seen; the emitted type gains an unknown arm the client can narrow on). 0041 as extended to variant sets — an absence is not a default.`,
        };
        if (VARIANT_POLICY_REQUIRED) {
          ctx.errors.push(entry);
          return 'never';
        }
        ctx.warnings.push(entry);
        ctx.population.variantSetsLackingPolicy += 1;
        // Phase 1 preserves today's output exactly, for the reason ENUM_POLICY_REQUIRED gives:
        // a new requirement must not alter what existing consumers already compile against.
        return rendered;
      }
      if (policy !== 'closed' && policy !== 'extensible') {
        ctx.errors.push({
          code: GENERATOR_ERROR_CODES.UNKNOWN_VARIANT_POLICY,
          contract: ctx.contractName,
          message: `${path}: \`enumPolicy: ${policy}\` is not \`closed\` or \`extensible\`. Refused rather than ignored — an ignored declaration is worse than an absent one, because it looks like it was honoured.`,
        });
        return 'never';
      }
      if (policy === 'closed') return rendered;

      // ---- THE UNKNOWN-VARIANT ARM. ADOPTED FROM THE CLIENT, NOT INVENTED. See
      // VARIANT_POLICY_REQUIRED for why the payload is the DISCRIMINANT and not the body.
      //
      // DO NOT "simplify" this to `| Record<string, unknown>`: that erases the known variants and
      // the whole point is that a client still narrows on the ones it knows.
      // DO NOT delete it: that makes the union closed, which is a compile-time claim stronger than
      // the runtime check beneath it — `0041`'s founding defect, one construct along.
      const tagKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(shape.discriminant)
        ? shape.discriminant
        : quoteLiteral(shape.discriminant);
      return `${rendered} | { readonly ${tagKey}: ${quoteLiteral(UNKNOWN_VARIANT_TAG)}; readonly ${UNKNOWN_VARIANT_PAYLOAD_FIELD}: string }`;
    }
  }

  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (!Array.isArray(node[key])) continue;
    const joiner = key === 'allOf' ? ' & ' : ' | ';

    const unclassified = node[key]
      .map((sub, i) => ({ sub, i }))
      .filter(({ sub }) => classifyNode(sub) === 'unclassified');
    if (unclassified.length > 0) {
      for (const { i } of unclassified) {
        ctx.errors.push({
          code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
          contract: ctx.contractName,
          message: `${path}/${key}/${i}: carries a keyword in neither SHAPE_KEYWORDS nor CONSTRAINT_KEYWORDS. Refused rather than assumed to be a constraint — the assumption dropped an \`if\`/\`else\` presence rule from a live contract and emitted a type permitting what the contract forbids.`,
        });
      }
      return 'never';
    }

    const shaped = node[key].map((sub, i) => ({ sub, i })).filter(({ sub }) => !isConstraintOnly(sub));
    if (shaped.length > 0) {
      return shaped.map(({ sub, i }) => renderType(sub, ctx, `${path}/${key}/${i}`)).join(joiner);
    }
    // Every member is genuinely constraint-only: the parent's own `type` is the answer.
    ctx.warnings.push({
      contract: ctx.contractName,
      message: `${path}: every \`${key}\` member carries only constraints, so the type comes from the parent. THE CONSTRAINT IS NOT EXPRESSED IN THE EMITTED TYPE and is still owed to runtime validation on the server.`,
    });
  }

  // `properties` with no `type` is an object in every use this corpus makes of it, and rendering
  // it as one is what lets a root shape emit. Without this the root branch would refuse a schema
  // that merely omits a redundant `type: object`.
  const type = node.type === undefined && node.properties !== undefined ? 'object' : node.type;
  if (Array.isArray(type)) {
    return type.map((t) => renderType({ ...node, type: t }, ctx, path)).join(' | ');
  }

  switch (type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      if (node.items === undefined) {
        // ---- AN ARRAY WITH NO `items` IS AN ABSTRACT SHAPE, AND ITS TYPE IS A PARAMETER.
        //
        // `common/pagination.schema.json`'s `collectionEnvelope.properties.data` is exactly this,
        // and the schema says why: *"The page. Redefined by each concrete response with its item
        // schema."* **That sentence describes a type parameter.** Refusing it was correct as a
        // default — an array of unknown element type is useless to a client — and wrong here,
        // because the element type is not unknown, it is DEFERRED.
        //
        // Emitting `unknown[]` was never a candidate: it is the confidently-wrong output this
        // file refuses everywhere else.
        ctx.currentDefNeedsTypeParam = true;
        return 'ReadonlyArray<T>';
      }
      return `ReadonlyArray<${renderType(node.items, ctx, `${path}/items`)}>`;
    }
    case 'object': {
      const properties = node.properties ?? {};
      const required = new Set(Array.isArray(node.required) ? node.required : []);
      const names = Object.keys(properties);
      if (names.length === 0 && node.additionalProperties === false) return 'Record<string, never>';
      const lines = names.map((prop) => {
        const optional = required.has(prop) ? '' : '?';
        const rendered = renderType(properties[prop], ctx, `${path}/properties/${prop}`);
        return `  readonly ${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(prop) ? prop : quoteLiteral(prop)}${optional}: ${rendered};`;
      });
      if (node.additionalProperties !== false) {
        // Recorded, not refused. `API_STANDARD.md` §7 says unknown fields are REJECTED, so an
        // object without `additionalProperties: false` is a contract gap — but it is not one of
        // the five things `0037` makes a refusal, and widening the refusal list here would be
        // this generator legislating.
        ctx.warnings.push({
          contract: ctx.contractName,
          message: `${path}: no \`additionalProperties: false\`. API_STANDARD.md §7 rejects unknown fields; the schema does not say so.`,
        });
        lines.push('  readonly [key: string]: unknown;');
      }
      return `{\n${lines.join('\n')}\n}`;
    }
    default:
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
        contract: ctx.contractName,
        message: `${path}: no \`type\`, \`enum\`, \`const\`, \`$ref\`, \`oneOf\`, \`anyOf\` or \`allOf\` this generator understands.`,
      });
      return 'never';
  }
}

/**
 * ===========================================================================================
 * A URN THAT DOES NOT RESOLVE MEANS TWO DIFFERENT THINGS AND ONLY ONE OF THEM IS THE
 * REFERRING CONTRACT'S FAULT
 * ===========================================================================================
 *
 * `GEN_UNRESOLVABLE_REF` asserts *"no file in the corpus declares this `$id`"*. THAT CLAIM IS ONLY
 * SOUND WHEN EVERY SCHEMA FILE WAS READABLE. If any file failed to parse, its `$id` was never read,
 * so the index is KNOWN-INCOMPLETE and the assertion is one the tool is not entitled to make.
 *
 * *** IT IS DELIBERATELY NOT AN ATTRIBUTION, AND THAT IS THE CAREFUL PART. *** This does NOT say
 * "the URN is declared by the file that failed to parse" — it CANNOT, because an unparseable file
 * has no readable `$id` and there is nothing to match against. Claiming otherwise would be
 * `architecture.md` §3c's worst variant: every fact true, the attribution invented. What it says is
 * narrower and checkable: **while N files are unread, "nothing declares this" is unsupportable.**
 *
 * SO THE FALLBACK IS BY THE STATE OF THE INDEX RATHER THAN BY THE IDENTITY OF THE MISSING FILE, and
 * the cost of that choice is stated rather than hidden: a URN that genuinely names nothing WILL be
 * reported as derived while an unrelated file is unparseable. **That is the safe direction** — it
 * defers a contract finding until the corpus is readable, rather than asserting one on an index that
 * could not see half the answer. The finding returns on the next run once the parse error is fixed.
 */
function pushUnresolvedUrn(ctx, ref, path) {
  const unread = ctx.schemaIndexIncomplete ?? 0;
  if (unread > 0) {
    ctx.errors.push({
      code: GENERATOR_ERROR_CODES.REF_UNRESOLVABLE_INDEX_INCOMPLETE,
      contract: ctx.contractName,
      message:
        `${path}: \`${ref}\` did not resolve, AND ${unread} schema file(s) could not be read, so ` +
        'the index is incomplete and "no file declares this `$id`" is not a claim this tool can ' +
        'make. DERIVED: fix the unreadable schema(s) first — buildSchemaIndex names them — and ' +
        're-run. If this ref is still unresolved then, it is a contract defect and will be ' +
        'reported as one.',
    });
    return;
  }
  ctx.errors.push({
    code: GENERATOR_ERROR_CODES.UNRESOLVABLE_REF,
    contract: ctx.contractName,
    message: `${path}: \`${ref}\` names a schema \`$id\` no file in the corpus declares.`,
  });
}

function renderRef(ref, ctx, path) {
  const localMatch = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (localMatch !== null) {
    // A generic def cannot be referenced without a parameter. Nothing in the corpus does this
    // today; refusing is what keeps that true rather than hoping.
    if (ctx.genericDefs !== undefined && ctx.genericDefs.has(localMatch[1])) {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
        contract: ctx.contractName,
        message: `${path}: \`${ref}\` names a def that emits as generic (it contains an array with no \`items\`), and a JSON Schema \`$ref\` carries no type argument. Redefine the concrete shape at the reference site, as every response in this corpus already does.`,
      });
      return 'never';
    }
    return pascalCase(localMatch[1]);
  }

  // ---- A POINTER DEEPER THAN `#/$defs/<name>` IS RESOLVED AND RENDERED INLINE.
  //
  // Added 2026-09-09. `platform-audit-read-v1` uses `#/$defs/recordCommon/properties/record_id`
  // four times — a valid JSON Pointer into a shared object's property, and the natural way to say
  // "the same shape as that field". The first version matched only `#/$defs/<name>` and refused
  // it as UNRESOLVABLE, which read as a contract defect and was a gap in the resolver.
  //
  // IT RENDERS INLINE RATHER THAN NAMING A TYPE, because the target is an anonymous sub-node: no
  // `$defs` key names it, so there is no name to export and inventing one would put a type in the
  // public surface that the contract never declared.
  const localDeep = /^#(\/.+)$/.exec(ref);
  if (localDeep !== null) {
    const target = resolvePointer(ctx.schemaRoot, localDeep[1]);
    if (target === undefined) {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNRESOLVABLE_REF,
        contract: ctx.contractName,
        message: `${path}: \`${ref}\` points at nothing in this schema.`,
      });
      return 'never';
    }
    return renderType(target, ctx, `${path}->${ref}`);
  }

  const urnMatch = /^(urn:[^#]+)#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref);
  if (urnMatch !== null) {
    const [, urn, def] = urnMatch;
    const target = ctx.schemaIndex.get(urn);
    if (target === undefined) {
      // `business-read-v1.schema.json` says so itself: "References to urn:dudo:schema:pagination:1
      // ... require a schema registry that resolves URNs. No such resolver exists yet."
      // THIS IS THAT RESOLVER, for generation only — and an unknown URN is a refusal, never a
      // guess, because guessing produces a type that compiles and means nothing.
      pushUnresolvedUrn(ctx, ref, path);
      return 'never';
    }
    // RECORD THE NAME, NOT JUST THE MODULE. The first version imported every `$def` the target
    // declared, which pulled in names nothing used — and one of them, `PrincipalId`, collided with
    // a name the importing module declares locally (TS2440).
    const used = ctx.imports.get(target.modulePath) ?? { target, names: new Set() };
    used.names.add(pascalCase(def));
    ctx.imports.set(target.modulePath, used);
    return `${pascalCase(def)}`;
  }

  // ---- A CROSS-FILE POINTER DEEPER THAN `#/$defs/<name>`. Resolved in the target document and
  // rendered inline, for the same reason as the local deep case: the node has no exported name.
  const urnDeep = /^(urn:[^#]+)#(\/.+)$/.exec(ref);
  if (urnDeep !== null) {
    const [, urn, pointer] = urnDeep;
    const target = ctx.schemaIndex.get(urn);
    if (target === undefined) {
      pushUnresolvedUrn(ctx, ref, path);
      return 'never';
    }
    const node = resolvePointer(target.doc, pointer);
    if (node === undefined) {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNRESOLVABLE_REF,
        contract: ctx.contractName,
        message: `${path}: \`${ref}\` resolves to a schema that exists but contains nothing at that pointer.`,
      });
      return 'never';
    }
    // Rendered against the TARGET document, so a nested `#/$defs/x` inside it resolves there
    // rather than here. Getting this wrong would silently bind a local name to a foreign shape.
    return renderType(node, { ...ctx, schemaRoot: target.doc }, `${path}->${ref}`);
  }

  // A DISTINCT CODE, because this one is OURS. `UNRESOLVABLE_REF` means the contract named
  // something that does not exist; this means the contract wrote a form THIS GENERATOR does not
  // implement. Same symptom, opposite author, and one code cannot carry both without the
  // composition tally attributing a tool limit to a contract.
  ctx.errors.push({
    code: GENERATOR_ERROR_CODES.UNSUPPORTED_REF_FORM,
    contract: ctx.contractName,
    message: `${path}: \`${ref}\` is a reference form this generator does not implement. It resolves \`#/$defs/<name>\`, \`urn:...#/$defs/<name>\`, and JSON Pointers into either.`,
  });
  return 'never';
}

/** Builds `$id` -> { modulePath, defs } across every schema in the corpus, including `common/**`. */
export function buildSchemaIndex(root = CONTRACTS_ROOT) {
  const index = new Map();
  const problems = [];
  for (const file of walk(root)) {
    if (!file.endsWith('.schema.json')) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (cause) {
      problems.push({
        code: GENERATOR_ERROR_CODES.SCHEMA_UNREADABLE,
        // NAMED SUBJECT, like every other finding. These were the last entries with no `contract`
        // field, so they rendered as `undefined: …` in the refusal list.
        contract: file.split(sep).pop().replace(/\.schema\.json$/, ''),
        message: `${relative(root, file)}: ${cause.message}`,
      });
      continue;
    }
    if (typeof parsed.$id !== 'string') {
      problems.push({
        code: GENERATOR_ERROR_CODES.SCHEMA_UNREADABLE,
        contract: file.split(sep).pop().replace(/\.schema\.json$/, ''),
        message: `${relative(root, file)}: no \`$id\`, so nothing can $ref it and this generator cannot index it.`,
      });
      continue;
    }
    index.set(parsed.$id, {
      file,
      modulePath: relative(root, file).replace(/\.schema\.json$/, '.ts'),
      sourceName: relative(root, file).split(sep).join('/'),
      defs: parsed.$defs ?? {},
      // The whole parsed document, so a pointer deeper than `#/$defs/<name>` can be resolved
      // against the file that owns it rather than against the file that referenced it.
      doc: parsed,
      // True when no `*.contract.yaml` sits beside it — `common/**` and `registries/**`.
      shared: !existsSync(file.replace(/\.schema\.json$/, '.contract.yaml')),
    });
  }
  return { index, problems };
}

/**
 * THE INDEPENDENT DERIVATION FOR `enumsExamined` AND FOR THE `oneOf` POPULATION. Walks every
 * `*.schema.json` on disk and counts nodes carrying an `enum` array and nodes carrying a `oneOf`
 * array — including schemas nothing references, which is the whole point.
 *
 * It shares no code path with emission: the emitter opens the schemas an admitted contract needs;
 * this opens all of them. **Two derivations that share a scope are one derivation**, so the scope
 * is deliberately different rather than the method.
 *
 * ===========================================================================================
 * *** `enums` COUNTS SHAPE-POSITION ENUMS ONLY, AND WITHOUT THAT THE PHASE-2 TRIGGER COULD
 * NEVER FIRE. Found by `qa-agent`, 2026-09-10. ***
 * ===========================================================================================
 *
 * `enumsExamined` increments inside `renderType` — enums rendered AS A TYPE. This counted EVERY
 * node carrying an `enum` array. **A constraint-position enum is never rendered as a type, so it
 * can never be counted by the first**, and the corpus holds one: `app-manifest`'s audit predicate,
 * `sensitivity: { not: { enum: [...] } }`.
 *
 * SO `enumsExamined === enumsInCorpus` WAS UNSATISFIABLE — 38 against a target of 39 — and the
 * "PHASE 2 IS DUE" arm could never print. **THAT IS THE IDENTICAL DEFECT AS `checkWired` SEARCHING
 * A SCRIPT LIST FOR A FILENAME: two populations that can never be equal, compared as though they
 * should be.** Two in one file, both in phase triggers, both found by somebody BUILDING AN
 * ASSERTION rather than by reading.
 *
 * AND THE GAP HAD TWO CAUSES WHILE THE MESSAGE NAMED ONE. Sixteen of the seventeen unreached enums
 * are registry schemas nothing references — true, and fixable. **The seventeenth is structural and
 * survives that fix**, so the day every registry is referenced the "due" arm would still have
 * stayed silent forever. Confounded, which is why nobody saw it.
 *
 * *** WHY COUNTING FEWER IS CORRECT HERE AND NOT A CHECK BEING WEAKENED — the distinction matters,
 * because narrowing what a check counts is the highest-suspicion change there is. *** `enumPolicy`
 * decides WHAT THE GENERATOR EMITS: `closed` emits the exact union, `extensible` emits it plus an
 * unknown arm. **A constraint-position enum emits nothing at all** — no type, so no client sees a
 * union, so `closed` and `extensible` have no consequence to choose between. The policy would
 * govern nothing.
 *
 * AND THE NARROWING IS ENUMERATED RATHER THAN SILENT: `constraintEnums` is counted and PRINTED
 * separately, so the excluded population is visible and a number moving in it is a finding. A check
 * that quietly stops counting something is the failure this whole file is built against; a check
 * that counts it in a second column is not.
 *
 * *** IT COUNTS `oneOf` OCCURRENCES AND DELIBERATELY DOES NOT CLASSIFY THEM. *** Classifying needs
 * `$ref` resolution against a document, which is emission's job — and a second implementation of
 * `classifyOneOf` here would be two copies of one rule that could disagree, which is the duplicated
 * constraint `workflow.md` §12 is about. So the independent figure is the crude one, and the
 * comparison it supports is the useful one: **the per-kind counts must sum to the `oneOf`s the
 * emitter REACHED, and the difference from this total is the unreached tail.**
 *
 * Renamed from `countEnumsInCorpus` on 2026-09-09 when it grew the second counter. A function whose
 * name describes half of what it does is the next reader's wrong assumption.
 */
/**
 * *** THE KEYWORDS WHOSE SUBTREES THIS GENERATOR NEVER RENDERS AS A TYPE. ***
 *
 * A subschema under `not`, `if`, `then` or `else` is a PREDICATE. `renderType` has no branch for
 * any of them — a node carrying one is shape-bearing and refuses rather than rendering — so an
 * `enum` inside one CANNOT be reached by `enumsExamined`, ever, by construction.
 *
 * Enumerated as its own list rather than derived from `SHAPE_KEYWORDS`, and the reason is the one
 * this file keeps relearning: a list that grows when JSON Schema grows would silently start
 * excluding enums from the corpus total, which is the direction that makes a migration look more
 * complete than it is. A keyword added here is a deliberate act.
 */
const NON_RENDERING_KEYWORDS = Object.freeze([
  'not', 'if', 'then', 'else',
  // ---- ADDED 2026-09-10, RULED BEFORE ANYTHING EXERCISES THEM. Cheap now, expensive later.
  //
  // `qa-agent` kept its own exclusion list a DELIBERATE STRICT SUPERSET of this one and flagged the
  // difference rather than reconciling it — correctly, because two lists agreeing today is a real
  // result only while they were written independently. But the day an `enum` lands under either
  // keyword the two disagree, AND THE DISAGREEMENT HAS A DIRECTION: this walk would count it as a
  // shape enum owing a policy while `renderType` never reaches it, so `examined` could never equal
  // `inCorpus` and phase 2 would be SILENTLY RE-BLOCKED. The defect just closed, arriving through a
  // keyword nobody listed.
  //
  // VERIFIED RATHER THAN ASSUMED: both are in `SHAPE_KEYWORDS`, and `renderType` HAS NO BRANCH FOR
  // EITHER — so their subtrees are in exactly the position `not`/`if`/`then`/`else` occupy.
  //
  // *** THE TWO ARE NOT THE SAME CASE AND LUMPING THEM WOULD BE THE WRONG REASON FOR A RIGHT
  // ANSWER. ***
  //
  //   `contains`      CAN NEVER BE TYPE-BEARING, in this generator or any other. It asserts that AT
  //                   LEAST ONE element matches; the element type of an array comes from `items`.
  //                   An enum here is a constraint permanently, so it owes no policy permanently.
  'contains',
  //   `propertyNames` IS NOT TYPE-BEARING TODAY AND COULD LEGITIMATELY BECOME SO. `propertyNames:
  //                   {enum: ['a','b']}` beside a schema-valued `additionalProperties` is precisely
  //                   `Record<'a'|'b', T>` — a union a client WOULD see. This generator does not
  //                   emit that shape, so today an enum there emits nothing and owes nothing.
  //
  // *** SO THIS LIST IS A STATEMENT ABOUT WHAT `renderType` RENDERS, NOT ABOUT JSON SCHEMA, AND IT
  // MUST MOVE WHEN `renderType` MOVES. THE DAY THIS GENERATOR LEARNS TO EMIT `Record<K,V>` FROM
  // `propertyNames`, REMOVE IT FROM THIS LIST IN THE SAME CHANGE. *** Leaving it would make the
  // corpus total silently under-count enums that DO reach a client, which re-blocks phase 2 by the
  // same mechanism this list was written to fix — the repair introducing the defect it repaired.
  'propertyNames',
  // AND A SEPARATE FINDING, RECORDED HERE BECAUSE THIS IS WHERE SOMEBODY WILL BE STANDING, NOT
  // FIXED HERE BECAUSE NOTHING EXERCISES IT: a node carrying `type: 'object'` AND `propertyNames`
  // renders today as an ordinary object and THE `propertyNames` CONSTRAINT IS SILENTLY DROPPED —
  // the same fail-open as the `if`/`else` presence rule that `classifyNode` was rebuilt to catch,
  // one keyword along. `patternProperties`, `unevaluatedProperties`, `unevaluatedItems`,
  // `prefixItems` and `dependentSchemas` are all shape-bearing with no branch either and are worth
  // the same question. Owed, unexercised, and named rather than left to be rediscovered.
]);

function countCorpusShapes(root) {
  let enums = 0;
  let constraintEnums = 0;
  let oneOfs = 0;
  let unparseable = 0;
  const walkNode = (node, inPredicate) => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walkNode(item, inPredicate);
      return;
    }
    if (Array.isArray(node.enum)) {
      if (inPredicate) constraintEnums += 1;
      else enums += 1;
    }
    if (Array.isArray(node.oneOf)) oneOfs += 1;
    for (const [key, value] of Object.entries(node)) {
      walkNode(value, inPredicate || NON_RENDERING_KEYWORDS.includes(key));
    }
  };
  for (const file of walk(root)) {
    if (!file.endsWith('.schema.json')) continue;
    try {
      // `false` explicitly: the document ROOT is not inside a predicate, and relying on the
      // parameter defaulting to `undefined` would make the whole walk depend on falsiness rather
      // than on a stated starting condition.
      walkNode(JSON.parse(readFileSync(file, 'utf8')), false);
    } catch {
      // *** COUNTED EXPLICITLY, NOT FOLDED INTO THE TOTAL AS `NaN`. ***
      //
      // The first version added `Number.NaN`, which blocks the trigger correctly — every
      // comparison against NaN is false — and blocks it **by accident of comparison semantics
      // rather than by design.** A reader meeting `enums in corpus: NaN` sees a bug, and the
      // obvious repair is to make it a number again, which silently restores the gate.
      //
      // The direction was right and the mechanism was not: counting an unparseable schema as ZERO
      // would shrink the corpus and make the gate EASIER to satisfy — the pessimistic-versus-
      // optimistic asymmetry, in the direction nobody questions.
      unparseable += 1;
    }
  }
  return { enums, constraintEnums, oneOfs, unparseable };
}

/**
 * *** THE SOURCE CONTRACT'S `status` IS STAMPED INTO EVERY GENERATED FILE. SR-10, 2026-09-10. ***
 *
 * THE DEFECT: `template-lifecycle-v1.contract.yaml` is `status: proposed` and its permissions are
 * PROPOSED, NOT GRANTED — yet the generated module exported
 *
 *     export const PlatformOrganizationsSetTemplatePermission = 'core.platform-organization.set-template' as const
 *
 * with nothing saying so. `0007` rule 4 is that a permission does not exist until it is in
 * `permission-catalog.yaml`; this was A SECOND PLACE IT APPEARED TO EXIST — importable, typed, and
 * **indistinguishable from a granted one by anything a consumer can see.** `web-agent` consumes this
 * directory and is told to prefer generated types over hand-written ones.
 *
 * WHY THE ROUTE SIDE DID NOT CATCH IT: `assertEveryRoutePermissionIsReachable` fails the build when a
 * ROUTE declares an unreachable permission. There is no route yet. The generated constant exists
 * before any route does, which is the whole point of contract-first — and it means the generated side
 * needs its own marker rather than inheriting the route side's.
 *
 * THREE STATES, AND THE THIRD IS WHY THIS IS NOT A BOOLEAN. An absence is not a default (`0041`'s
 * reasoning, applied to a header):
 *
 *   `accepted`            the ordinary case; the file says so positively rather than by silence
 *   any other value       a LOUD banner naming the value — `proposed`, `draft`, anything
 *   NO CONTRACT AT ALL    shared schemas under `common/` and `registries/` have no `*.contract.yaml`
 *                         beside them, so they have no status to report. Saying "unknown" would be
 *                         a false alarm on every shared module; saying nothing would let a genuinely
 *                         missing status hide among them. It is stated as its own case.
 *
 * IT IS A COMMENT AND IT IS NOT A CONTROL, WHICH MUST BE SAID PLAINLY HERE RATHER THAN ASSUMED.
 * Nothing refuses an import of a constant from a `proposed` contract, and this header does not make
 * one unusable. What it does is remove the *indistinguishability* — a consumer can no longer be
 * unaware. The control, if one is wanted, is a build-time check that no non-generated file imports a
 * `*Permission` constant whose source contract is unaccepted, and that is owed to `0037` and to
 * whoever owns the gate. `security.md` §8 is unaffected either way: no agent grants a permission by
 * importing its name.
 */
const HEADER = (sourceName, contractStatus) => {
  const statusLine =
    contractStatus === null || contractStatus === undefined
      ? ' * Contract:  NONE — this is a shared schema with no `*.contract.yaml` beside it, so it\n' +
        ' *            declares no status. That is expected for `common/` and `registries/`.'
      : contractStatus === 'accepted'
        ? ' * Contract:  status `accepted`.'
        : ` * Contract:  *** status \`${contractStatus}\` — NOT ACCEPTED. ***\n` +
          ' *\n' +
          ' *            THE SOURCE CONTRACT IS NOT ACCEPTED, SO NOTHING BELOW IS AGREED. Types may\n' +
          ' *            change shape without a version bump, and ANY `*Permission` CONSTANT BELOW\n' +
          ' *            NAMES A PERMISSION THAT MAY NOT EXIST: docs/decisions/0007 rule 4 — a\n' +
          ' *            permission does not exist until it is in packages/contracts/registries/\n' +
          ' *            permission-catalog.yaml. Importing the name neither creates nor grants it,\n' +
          ' *            and a route gated on it will refuse every caller under deny-by-default.\n' +
          ' *            Build against this only if you are prepared to rewrite when it is accepted.';
  return `/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/${sourceName}
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
${statusLine}
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */
`;
};

/** Emits one module's text. Pure: no file access, so it is testable without a filesystem. */
export function emitModule({ schema, contractName, sourceName, schemaIndex, operations, contractStatus = null, schemaIndexIncomplete = 0 }) {
  const ctx = {
    contractName,
    schemaIndex,
    // How many schema files `buildSchemaIndex` could not read. NOT a boolean: the count appears in
    // the refusal message, because "the index is incomplete" is a claim a reader should be able to
    // act on and a number tells them how much is missing. Defaults to 0 so a caller that does not
    // pass it gets today's behaviour — and 0 is the honest default here rather than a guess, because
    // a caller with no index problems to report has none.
    schemaIndexIncomplete,
    schemaRoot: schema,
    imports: new Map(),
    errors: [],
    warnings: [],
    // Counted here rather than inferred from the warning list: a warning can be suppressed,
    // deduplicated or filtered, and the phase-2 trigger must not depend on how findings are
    // presented. `enumsExamined` is also the population half — "0 lacking" and "no enums were
    // read" render identically without it.
    population: {
      enumsExamined: 0,
      enumsLackingPolicy: 0,
      variantSetsExamined: 0,
      variantSetsLackingPolicy: 0,
      oneOfsByKind: newOneOfKindCounts(),
    },
  };

  const defs = schema.$defs ?? {};

  /**
   * Defs that will emit as generic — those containing an array with no `items` anywhere in their
   * own subtree. Computed BEFORE rendering, because `renderRef` has to refuse a bare reference to
   * one: `CollectionEnvelope` without a parameter does not compile, and emitting it would be the
   * dangling-import failure one level down. Does not follow `$ref`, deliberately — a def is
   * generic because of its own shape, not because of what it points at.
   */
  const hasAbstractArray = (node) => {
    if (node === null || typeof node !== 'object') return false;
    if (node.type === 'array' && node.items === undefined) return true;
    return Object.values(node).some((v) =>
      Array.isArray(v) ? v.some(hasAbstractArray) : hasAbstractArray(v),
    );
  };
  ctx.genericDefs = new Set(Object.keys(defs).filter((d) => hasAbstractArray(defs[d])));

  const body = Object.keys(defs).map((defName) => {
    ctx.currentDefNeedsTypeParam = false;
    const rendered = renderType(defs[defName], ctx, `#/$defs/${defName}`);
    const param = ctx.currentDefNeedsTypeParam ? '<T>' : '';
    return `export type ${pascalCase(defName)}${param} = ${rendered};\n`;
  });

  // ---- THE ROOT SHAPE. A schema whose payload sits at the ROOT rather than under `$defs`.
  //
  // *** THIS WAS A SILENT GAP AND IT IS WHY `error-envelope` LOOKED CLEAN. *** That file's content
  // is at `#/properties/error/allOf`; its `$defs` holds one entry. Walking `$defs` alone visited
  // none of it, so the file produced **zero errors and zero warnings because nothing read it** —
  // `§11a`'s empty-list reader inside the emitter, where "nothing was wrong" and "nothing was
  // examined" render identically.
  //
  // The root type is named after the schema file, which is the only name available: no `$defs` key
  // names it, and the `$id` is a URN rather than an identifier.
  if (classifyNode(schema) === 'shape' && (schema.properties !== undefined || schema.type !== undefined)) {
    ctx.currentDefNeedsTypeParam = false;
    const rootName = pascalCase(sourceName.split('/').pop().replace(/\.schema\.json$/, ''));

    // ---- BACKSTOP: A DUPLICATE EXPORT NAME IS WRONG WHATEVER CAUSED IT.
    //
    // Ranked deliberately (`architecture.md` §3a): the `$ref`-with-shape-sibling refusal above is
    // the LOAD-BEARING control, because it catches the cause. **This catches the symptom from any
    // cause**, including ones neither of us has thought of — a `$defs` key that happens to
    // pascal-case to the file's own name would collide with no `$ref` involved anywhere.
    //
    // It matters that this fails HERE rather than at `tsc`: a duplicate emitted silently is
    // reported as success by `--check`, and the failure then surfaces in a different gate from the
    // one that produced it, which is how a defect gets attributed to the wrong tool.
    // *** THE CAUSE IS EVALUATED BEFORE THE BACKSTOP, AND THE ORDER IS THE WHOLE POINT. ***
    //
    // The first version checked the name collision FIRST and only rendered in the `else`. Both
    // mechanisms worked — and on the ONE INPUT THAT PRODUCED THIS WORK, a root carrying `$ref` AND
    // `type`, the backstop reached it first and reported *"duplicate export name"*. **The design
    // ranked the cause as load-bearing and the execution order contradicted the ranking**, so an
    // author was told the symptom, would rename, and would meet the real refusal on the next run —
    // **the right answer in two steps instead of one.**
    //
    // Rendering first lets `renderType` report the unimplemented intersection; the collision is
    // reported only when nothing more specific was found.
    const errorsBefore = ctx.errors.length;
    const rendered = renderType(schema, ctx, '#');
    const causeFired = ctx.errors.length > errorsBefore;

    if (causeFired) {
      // Something more specific is already reported. Adding the collision here would make one
      // defect read as two, which is the mirror of reporting the symptom alone.
    } else if (Object.keys(defs).map(pascalCase).includes(rootName)) {
      ctx.errors.push({
        code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
        contract: contractName,
        message: `the root shape would emit \`${rootName}\`, which a \`$defs\` entry already exports. Two exports of one name do not compile; refused here rather than left for the type-checker, so the failure lands in the gate that caused it.`,
      });
    } else {
      const param = ctx.currentDefNeedsTypeParam ? '<T>' : '';
      body.push(`export type ${rootName}${param} = ${rendered};\n`);
    }
  }

  const operationLines = operations
    .filter((op) => typeof op.id === 'string' && op.id !== '')
    .map((op) => {
      const errorList = op.errorsList ?? [];
      const errorUnion = errorList.length === 0 ? 'never' : errorList.map(quoteLiteral).join(' | ');
      return (
        `export type ${pascalCase(op.id)}Error = ${errorUnion};\n` +
        `export const ${pascalCase(op.id)}Permission = ${quoteLiteral(op.permission ?? 'none')} as const;\n`
      );
    });

  // `.schema.json`, NOT `.contract.yaml` — `sourceName` is the schema's path. The first version
  // of this line used the wrong suffix, so the replace matched nothing, the comparison could
  // never be true, and a schema that `$ref`s its OWN urn would have emitted an import of itself.
  const selfModulePath = sourceName.replace(/\.schema\.json$/, '.ts');
  /** Names this module declares itself. An import of one of them is a TS2440 redeclaration. */
  const localNames = new Set(Object.keys(defs).map(pascalCase));
  const importLines = [...ctx.imports.values()]
    .filter(({ target }) => target.modulePath !== selfModulePath)
    .map(({ target, names }) => {
      const from = dirname(selfModulePath);
      let rel = relative(from, target.modulePath).split(sep).join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      // ONLY WHAT IS USED, AND NEVER A NAME DECLARED LOCALLY. Both were TS errors on the second
      // run: importing every `$def` produced unused imports, and `PrincipalId` arrived from
      // `common/` while the same module also declared it, which does not compile.
      const wanted = [...names].filter((n) => !localNames.has(n)).sort();
      if (wanted.length === 0) return null;
      return `import type { ${wanted.join(', ')} } from '${rel}';`;
    })
    .filter((line) => line !== null);

  // ---- THE FLOOR, APPLIED TO EMISSION ITSELF.
  //
  // A module that emits no type is indistinguishable from a schema nobody read, and that is
  // exactly how the `$defs`-only walk hid: `error-envelope` returned zero errors and zero
  // warnings, which reads identically to "clean". A schema in this corpus describes shapes; one
  // that yields none was not understood.
  if (body.length === 0) {
    ctx.errors.push({
      code: GENERATOR_ERROR_CODES.UNSUPPORTED_SCHEMA_NODE,
      contract: contractName,
      message:
        'This schema produced NO types — no `$defs` entries and no root shape. A module that ' +
        'emits nothing is indistinguishable from one nothing read, so it is refused rather than ' +
        'written empty.',
    });
  }

  const text = [
    HEADER(sourceName, contractStatus),
    ...(importLines.length > 0 ? [importLines.join('\n'), ''] : []),
    ...body,
    ...(operationLines.length > 0 ? ['', ...operationLines] : []),
  ].join('\n');

  return {
    text,
    errors: ctx.errors,
    warnings: ctx.warnings,
    // The shared schemas this module imports from. `run` uses these to emit the closure — a
    // module that imports a file nothing generates does not compile.
    referenced: [...ctx.imports.values()],
    population: ctx.population,
  };
}

// ---------------------------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------------------------

function loadOutline(contractPath) {
  return outlineYaml(readFileSync(contractPath, 'utf8'));
}

export function run({ mode = 'emit', root = CONTRACTS_ROOT, outputRoot = OUTPUT_ROOT } = {}) {
  const { pairs, totals } = discoverContracts(root);
  const { index: schemaIndex, problems } = buildSchemaIndex(root);

  const report = {
    mode,
    population: {
      contractFilesFound: totals.contractFiles,
      schemaFilesFound: totals.schemaFiles,
      schemasWithoutContract: totals.schemasWithoutContract,
      contractsAdmitted: 0,
      contractsRefused: 0,
      modulesEmitted: 0,
      sharedModulesEmitted: 0,
      modulesDrifted: 0,
      contractsDeclaringRequestClass: 0,
      contractsLackingRequestClass: 0,
      contractsPublishingNoOperations: 0,
      enumsExamined: 0,
      enumsLackingPolicy: 0,
      variantSetsExamined: 0,
      variantSetsLackingPolicy: 0,
      oneOfsByKind: newOneOfKindCounts(),
    },
    refusals: [],
    warnings: [...problems],
    drift: [],
  };

  // ---- THE FLOOR. `workflow.md` §11a: a checker handed nothing reports success, which is the
  // most confident wrong answer it can give. An empty corpus is a failure, never a clean run.
  if (totals.contractFiles === 0 || totals.schemaFiles === 0) {
    report.fatal =
      `Examined 0 contracts and ${totals.schemaFiles} schemas under ${root}. A run that finds ` +
      'nothing is a broken walk, not a clean corpus.';
    return report;
  }

  /** Module source names already written or compared, so the closure never emits one twice. */
  const emittedModules = new Set();
  /** Shared schemas referenced by something already emitted, awaiting their own emission. */
  const pending = [];
  /** sourceName -> { label, text, referenced }. NOTHING is written until the graph is checked. */
  const staged = new Map();
  /** sourceName of every module this run refused, directly or by cascade. */
  const refusedModules = new Set();
  /** sourceName of every module reached through the shared closure rather than as a contract. */
  const sharedNames = new Set();

  /** Writes a module, or compares it against the committed copy. One place, so the two modes
   *  cannot disagree about which files exist. */
  const deliver = (label, schemaRelative, text) => {
    emittedModules.add(schemaRelative);
    // THE SPLIT IS COUNTED WHERE THE TOTAL IS COUNTED, AND THAT IS THE FIX RATHER THAN AN
    // ADJUSTMENT. The first version incremented `sharedModulesEmitted` at STAGING and
    // `modulesEmitted` at DELIVERY, so a shared module staged and then cascade-refused was counted
    // as emitted and never written: 2 reported, 1 on disk. **A population report that does not
    // reconcile is worse than no report, because it is what everyone else checks their work
    // against.** One code path now produces both numbers, so they cannot disagree.
    if (sharedNames.has(schemaRelative)) report.population.sharedModulesEmitted += 1;
    const outPath = join(outputRoot, schemaRelative.replace(/\.schema\.json$/, '.ts'));
    if (mode === 'check') {
      const committed = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
      if (committed !== text) {
        report.population.modulesDrifted += 1;
        report.drift.push({
          contract: label,
          path: relative(root, outPath),
          reason:
            committed === null
              ? 'no committed output'
              : 'committed output differs from a fresh generation',
        });
      }
    } else {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, text, 'utf8');
    }
    report.population.modulesEmitted += 1;
  };

  for (const pair of pairs) {
    const sourceName = relative(root, pair.contractPath).split(sep).join('/');

    if (!existsSync(pair.schemaPath)) {
      report.population.contractsRefused += 1;
      report.refusals.push({
        code: GENERATOR_ERROR_CODES.SCHEMA_MISSING,
        contract: pair.name,
        message: `No sibling ${relative(root, pair.schemaPath)}. The machine-readable half is where the shapes live.`,
      });
      continue;
    }

    const outlineResult = loadOutline(pair.contractPath);
    if (!outlineResult.ok) {
      report.population.contractsRefused += 1;
      for (const err of outlineResult.errors) {
        report.refusals.push({ code: err.code, contract: pair.name, message: `line ${err.line}: ${err.message}` });
      }
      continue;
    }

    const admission = admitContract(outlineResult.outline, { name: pair.name });
    report.warnings.push(...admission.warnings);
    // *** ONLY CONTRACTS THAT PUBLISH OPERATIONS ARE COUNTED. ***
    //
    // The first version counted every contract, so `account-identifier-v1` — which declares
    // `publishesOperations: false` and CORRECTLY has no class, because a class is a property of a
    // route and it has none — sat permanently in the lacking set. **The count floors at 1, the
    // `lacking === 0` trigger can never hold, and the day the remaining ten declare, the FATAL
    // stays silent and nothing tells anyone phase 3 is due.**
    //
    // It is silent today for the right reason on the wrong run — 11 ≠ 0 — which is why it would
    // have survived until the one run where it mattered.
    if (admission.publishesOperations) {
      // FULLY declared — every published operation has an effective class, its own or the
      // contract's. A contract-level declaration that does not fit one of its operations is NOT
      // fully declared, and counting contracts rather than operations would have hidden exactly
      // that case in `confirmation-v1`.
      if (admission.fullyDeclared) report.population.contractsDeclaringRequestClass += 1;
      else report.population.contractsLackingRequestClass += 1;
    } else {
      report.population.contractsPublishingNoOperations += 1;
    }
    if (!admission.ok) {
      report.population.contractsRefused += 1;
      report.refusals.push(...admission.errors);
      continue;
    }

    let schema;
    try {
      schema = JSON.parse(readFileSync(pair.schemaPath, 'utf8'));
    } catch (cause) {
      report.population.contractsRefused += 1;
      report.refusals.push({
        code: GENERATOR_ERROR_CODES.SCHEMA_UNREADABLE,
        contract: pair.name,
        message: cause.message,
      });
      continue;
    }

    const operations = admission.operations.map((op) => ({
      ...op,
      errorsList: readInlineFlowSequence(op.errorsRaw) ?? [],
    }));

    const schemaRelative = relative(root, pair.schemaPath).split(sep).join('/');
    const emitted = emitModule({
      schema,
      contractName: pair.name,
      sourceName: schemaRelative,
      schemaIndex,
      operations,
      // Read from the outline at the call site rather than threaded through `admitContract`.
      // `admitContract` answers "may this contract be emitted at all"; the status is a fact ABOUT
      // the contract that the header reports and admission does not act on, and folding it into
      // the admission result would make a checker's return value the carrier for a comment's
      // input. `scalar()` returns null when the key opens a block or is absent, which lands in
      // HEADER's third state rather than being mistaken for `accepted`.
      contractStatus: outlineResult.outline.scalar('status'),
      schemaIndexIncomplete: problems.length,
    });

    if (emitted.errors.length > 0) {
      report.population.contractsRefused += 1;
      report.refusals.push(...emitted.errors);
      continue;
    }
    report.warnings.push(...emitted.warnings);
    mergeEmittedPopulation(report.population, emitted.population);
    report.population.contractsAdmitted += 1;

    staged.set(schemaRelative, {
      label: pair.name,
      text: emitted.text,
      referenced: emitted.referenced.map(({ target }) => target.sourceName),
    });
    for (const { target } of emitted.referenced) pending.push(target);
  }

  // ---------------------------------------------------------------------------------------
  // THE SHARED-SCHEMA CLOSURE. Defect 1, found by `tsc --noEmit --strict` on the first run.
  // ---------------------------------------------------------------------------------------
  //
  // `audit-read-v1` and `business-read-v1` both emitted
  // `import type { … } from '../../common/pagination.ts'` — a module the generator had decided
  // NOT to produce, because `common/pagination.schema.json` has no contract beside it and the
  // walk only ever emitted contract schemas. **TS2307 on both.**
  //
  // THE EMITTED SET MUST BE THE TRANSITIVE CLOSURE OF WHAT ADMITTED CONTRACTS REFERENCE, and the
  // other two options were weighed and rejected:
  //
  //   INLINE the shared shapes into each consumer. Refused: it re-declares `PageSize` and
  //   `Cursor` in every module that pages, which is EXACTLY `0037` requirement 2 — "generated
  //   types are consumed, never re-declared" — violated by the generator itself.
  //
  //   REFUSE a contract that references a schema outside the contract set. Refused: it would
  //   reject `business-read-v1` and `audit-read-v1`, two accepted contracts doing nothing wrong.
  //   A refusal that fires on correct input is a broken tool, not a strict one.
  //
  // **Emitting a dangling import was never a candidate: it is the one outcome that looks like
  // success until somebody compiles it.**
  const seenShared = new Set();
  while (pending.length > 0) {
    const target = pending.pop();
    if (seenShared.has(target.sourceName)) continue;
    seenShared.add(target.sourceName);

    // *** `staged`, NOT `emittedModules`. THIS IS THE `SHARED` MISCOUNT, AND THE CAUSE IS A GUARD
    // THAT MY OWN EARLIER CHANGE MADE DEAD WITHOUT ANYTHING SAYING SO. ***
    //
    // This line read `emittedModules.has(...)`. That was correct when modules were delivered
    // INLINE — `deliver` populates `emittedModules`, so a contract already written was skipped
    // here. **When delivery moved to the end for the dangling-import invariant, `emittedModules`
    // was empty during this loop and the guard stopped guarding.** Nothing failed: a contract
    // schema reached through a URN `$ref` was re-emitted, `staged.set` OVERWROTE its own entry —
    // so the total stayed right — and `sharedNames` gained a CONTRACT module's name, which
    // `deliver` then counted as shared. **11 emitted, 11 on disk, 2 shared reported, 1 shared
    // written.**
    //
    // `workflow.md` §12's value-change case, in control flow rather than in a constant: no symbol
    // moved, so the compiler saw nothing; what moved was WHEN a set is populated. The total was
    // self-correcting by accident and the split was not, which is why only half the report lied.
    // *** THE FALSIFIER, STATED HERE RATHER THAN ONLY IN A REPORT. ***
    // If a run still shows `sharedModulesEmitted` disagreeing with what is on disk WHILE the
    // shared-closure reconciliation below stays silent, THIS DIAGNOSIS IS WRONG RATHER THAN
    // INCOMPLETE — the reconciliation fires on exactly the condition described above. Do not patch
    // the counter; the cause is somewhere this comment does not describe.
    if (staged.has(target.sourceName)) continue;

    // ONE NAMING CONVENTION FOR THE SUBJECT OF A REFUSAL. Contract refusals say `business-read-v1`
    // and shared ones said `common/pagination.schema.json`, so two findings of the same class read
    // as two classes. Both now use the bare contract-style name.
    const displayName = target.sourceName.split('/').pop().replace(/\.schema\.json$/, '');
    const emitted = emitModule({
      schema: target.doc,
      contractName: displayName,
      sourceName: target.sourceName,
      schemaIndex,
      operations: [],
      schemaIndexIncomplete: problems.length,
    });
    if (emitted.errors.length > 0) {
      report.refusals.push(...emitted.errors);
      refusedModules.add(target.sourceName);
      continue;
    }
    report.warnings.push(...emitted.warnings);
    mergeEmittedPopulation(report.population, emitted.population);
    sharedNames.add(target.sourceName);
    staged.set(target.sourceName, {
      label: displayName,
      text: emitted.text,
      referenced: emitted.referenced.map(({ target: t }) => t.sourceName),
    });
    for (const { target: next } of emitted.referenced) pending.push(next);
  }

  // =========================================================================================
  // *** THE INVARIANT: A REFUSED MODULE IS NEVER IMPORTED. ***
  // =========================================================================================
  //
  // Nothing has been written yet. Everything above STAGED its output; this is where the import
  // graph is checked and only then is anything delivered.
  //
  // **THE DANGLING IMPORT APPEARED TWICE, BY TWO DIFFERENT ROUTES** — first because shared
  // schemas were never emitted at all, then because `common/pagination.schema.json` REFUSED while
  // three admitted contracts imported it. Both times the emitted modules were individually
  // correct and the SET was not. So the repair is not another special case: **a module whose
  // transitive closure contains a refusal is itself refused**, and the two facts — "this module
  // was refused" and "this module is imported" — can no longer both be true at the end of a run.
  //
  // It cascades to a fixed point, because a contract may import a shared module that imports
  // another. A contract refused this way is reported with the module that caused it, so the
  // reader is sent to the actual defect rather than to the contract that happened to reference it.
  let cascaded = true;
  while (cascaded) {
    cascaded = false;
    for (const [name, module] of staged) {
      const broken = module.referenced.find(
        (ref) => refusedModules.has(ref) || (!staged.has(ref) && ref !== name),
      );
      if (broken === undefined) continue;
      staged.delete(name);
      refusedModules.add(name);
      cascaded = true;
      report.refusals.push({
        code: GENERATOR_ERROR_CODES.UNEMITTABLE_DEPENDENCY,
        contract: module.label,
        message: `imports \`${broken}\`, which this run refused or could not emit. A module is not written while anything it imports is missing — a dangling import is the one outcome that looks like success until somebody compiles it.`,
      });
    }
  }

  for (const [name, module] of staged) deliver(module.label, name, module.text);

  // ---- RECONCILIATION. The `SHARED` split was wrong for two runs and nothing said so.
  //
  // A contract schema must never be reached through the shared closure: it is already staged as a
  // contract, and counting it as shared is exactly the miscount above. Asserted rather than
  // trusted, because "one place produces both numbers" was true when they last disagreed —
  // **making a mechanism single is not the same as making it correct.**
  const contractSchemaNames = new Set(
    pairs.map((p) => relative(root, p.schemaPath).split(sep).join('/')),
  );
  // AND THE RECONCILIATION IS VACUOUS IF THE CLOSURE NEVER RAN, so the population reports the
  // set it examines. `qa-agent`'s point about its own precision control applies here verbatim:
  // a check over an empty set passes whether it is precise or never looked at anything, which is
  // the floor-on-empty-input failure wearing a reconciliation's clothes. A zero here is visible
  // rather than silently green.
  report.population.sharedSchemasReached = sharedNames.size;
  const misclassified = [...sharedNames].filter((n) => contractSchemaNames.has(n));
  if (misclassified.length > 0) {
    report.fatal =
      `${misclassified.length} contract schema(s) were reached through the SHARED closure and ` +
      `counted as shared: ${misclassified.join(', ')}. The population report's split is wrong ` +
      'whenever this fires, and a population report is what everyone else checks their work against.';
  }

  // ---- `0039` PHASE 3'S TRIGGER, AND IT FIRES RATHER THAN WAITING TO BE REMEMBERED.
  //
  // The moment every contract declares `requestClass:`, the fallback is dead code and the warning
  // is noise — but nothing would say so, and `REQUEST_CLASS_REQUIRED` would sit `false` forever
  // while the field it guards is universally present. `workflow.md` §12: "a rule whose execution
  // depends on remembering at the right moment should become something that fails the build."
  // *** TWO CONDITIONS, AND EXISTENCE ALONE IS NOT ONE OF THEM. ***
  //
  // `0039`'s correction gates phase 3 on the route-table check LANDING, not merely on every
  // contract declaring — because requiring a field nothing validates spreads an unenforceable
  // declaration across fifteen files WITH THE APPEARANCE OF ENFORCEMENT.
  //
  // Both conditions are facts this tool can read:
  //   1. `scripts/check-request-class.mjs` EXISTS.
  //   2. It is WIRED INTO the root `package.json`'s `test` script. **A check that exists and is not
  //      run is the state `check:source-bytes` and `check:route-fields` spent a day climbing out
  //      of**, and existence alone would let phase 3 turn on behind a file nobody executes.
  //
  // AND THE TWO OUTCOMES ARE DISTINGUISHABLE, which is the property that made the cause/backstop
  // ordering diagnosable: "phase 3 is due" and "phase 3 is blocked, on THIS condition" must never
  // render the same way.
  //
  // ===========================================================================================
  // *** `checkWired` WAS UNCONDITIONALLY FALSE UNTIL 2026-09-10, SO PHASE 3 COULD NEVER FIRE. ***
  // ===========================================================================================
  //
  // It read `pkg.scripts.test.includes('check-request-class')` — THE FILENAME. A `test` script can
  // only ever contain the npm SCRIPT NAME, which is `check:request-class`. One character, `-`
  // against `:`, and `checkExists && checkWired` was unreachable however anyone edited package.json.
  //
  // *** THE REFUSAL IT PRODUCED IS `§11a`'s WORST VARIANT — IT NAMED A REMEDY THAT HAD ALREADY BEEN
  // PERFORMED: *** "scripts/check-request-class.mjs exists and is NOT referenced by the root `test`
  // script." It IS referenced. A correct author reads that, goes to wire it, finds it already wired,
  // and the honest conclusions left are "I have misunderstood the tool" or "package.json is wrong" —
  // BOTH FALSE. And it lands on whoever is executing phase 3, at the moment they are trying to.
  // The comment above asserting it is "WIRED INTO the root package.json's test script" was a §3c
  // claim about a file, one line from the code that read that file wrongly.
  //
  // THE SPEC WAS THE TEAM LEAD'S AND CONFLATED A FILENAME WITH A SCRIPT NAME; the implementation was
  // faithful to it. What let it survive is that THE CONDITION GUARDING IT HAS NEVER BEEN TRUE — a
  // branch nothing reaches is a branch nothing tests.
  //
  // THE FIX IS NOT `-` TO `:`. That trades one transcribed string for another and breaks the day
  // somebody renames the npm script. BOTH FACTS ARE DERIVED FROM package.json AND NEITHER IS
  // WRITTEN TWICE (`workflow.md` §11a — derive the subject from the artifact):
  //
  //   wired  ⟺  ∃ name : scripts[name] contains 'check-request-class.mjs'
  //                    ∧ scripts.test references that name
  //
  // The only transcribed anchor left is the SCRIPT FILE'S OWN PATH, which is the stable one: it is
  // the thing `checkExists` already tests for, so a rename breaks both halves together and loudly
  // rather than one half silently. `qa-agent`'s rule about names and paths being different halves —
  // pick the anchor that is most stable, and that is a judgement about the artifact.
  const repoRoot = resolve(HERE, '..', '..', '..');
  const routeClassCheck = join(repoRoot, 'scripts', 'check-request-class.mjs');
  const checkExists = existsSync(routeClassCheck);
  let checkWired = false;
  /** Named so the refusal can say WHICH half failed rather than "not wired". */
  let wiringDetail = 'package.json could not be read';
  if (checkExists) {
    try {
      const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
      const scripts = pkg?.scripts ?? {};
      // Every script whose COMMAND invokes the check file. Usually one; more than one is fine and
      // any of them satisfies the wiring.
      const runners = Object.keys(scripts).filter((name) =>
        String(scripts[name] ?? '').includes('check-request-class.mjs'),
      );
      const testScript = String(scripts.test ?? '');
      // `\b` on both sides so `check:request-class` does not match inside a longer name a future
      // script might carry, and so `npm run check:request-class` matches wherever it sits in a chain.
      const wiredBy = runners.filter((name) =>
        new RegExp(`(^|[^\\w:-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w:-]|$)`).test(testScript),
      );
      checkWired = wiredBy.length > 0;
      wiringDetail =
        runners.length === 0
          ? 'no npm script invokes scripts/check-request-class.mjs, so there is nothing for `test` to reference'
          : checkWired
            ? `\`test\` runs ${wiredBy.join(', ')}`
            : `${runners.join(', ')} invoke(s) the check but the root \`test\` script references none of them`;
    } catch {
      checkWired = false;
      wiringDetail = 'package.json could not be read or parsed';
    }
  }

  const declarationsComplete =
    report.population.contractsLackingRequestClass === 0 &&
    report.population.contractsDeclaringRequestClass > 0;

  if (!REQUEST_CLASS_REQUIRED && declarationsComplete) {
    if (checkExists && checkWired) {
      raiseMigrationNotice(
        `Every publishing contract declares \`requestClass:\` (${report.population.contractsDeclaringRequestClass}), ` +
        'and scripts/check-request-class.mjs exists AND is wired into `npm test`. ' +
        'PHASE 3 OF docs/decisions/0039 IS DUE: set REQUEST_CLASS_REQUIRED to true and delete the ' +
        'block-key fallback in admitContract. A deliberate stop, not a defect.',
      );
    } else {
      raiseMigrationNotice(
        `Every publishing contract declares \`requestClass:\` (${report.population.contractsDeclaringRequestClass}), ` +
        'BUT PHASE 3 IS BLOCKED and this is a different state from being due. ' +
        (checkExists
          ? 'scripts/check-request-class.mjs exists and the root `test` script does not run it — ' +
            `MEASURED: ${wiringDetail}. ` +
            'A check that is not run is not a check, and requiring the field behind it would be ' +
            'enforcement in appearance only. THE REMEDY IS TO MAKE `test` RUN THE npm SCRIPT THAT ' +
            'INVOKES THAT FILE; this tool derives both halves from package.json and names neither, ' +
            'so it cannot be satisfied by editing a string it expects.'
          : 'scripts/check-request-class.mjs DOES NOT EXIST. Until it does, nothing validates a ' +
            'declared class against the route it names (0039), so requiring the field would spread ' +
            'an unenforceable declaration across every contract.'),
      );
    }
  }

  // ---- PHASE 2's TRIGGER, GATED ON THE POPULATION RATHER THAN ON THE FINDINGS.
  //
  // *** THE FIRST VERSION WOULD HAVE ANNOUNCED A COMPLETE MIGRATION OVER A CORPUS IT NEVER SAW. ***
  // `enumsExamined` counts enums the generator REACHES — contract schemas, plus shared schemas an
  // admitted contract imports. **17 of the corpus's 38 enum occurrences are in registry schemas no
  // contract references**, so the emitter never opens them. `lacking === 0` was therefore
  // satisfiable while more than half the enums had never been looked at.
  //
  // `§11a`: report the population examined AND AN INDEPENDENTLY DERIVED EXPECTATION. This counts
  // enum nodes by walking every `*.schema.json` on disk — a different mechanism from the emission
  // path, which is the point: two derivations that share a scope are one derivation.
  const corpusShapes = countCorpusShapes(root);
  report.population.enumsInCorpus = corpusShapes.enums;
  report.population.constraintEnumsInCorpus = corpusShapes.constraintEnums;
  report.population.oneOfsInCorpus = corpusShapes.oneOfs;
  report.population.unparseableSchemas = corpusShapes.unparseable;

  // ---- SEVERAL MIGRATIONS CAN REACH A PHASE BOUNDARY AT ONCE, AND THIS IS ONE SLOT.
  //
  // The enum trigger fires on EVERY run today (its "not due" branch), so a second assignment would
  // silently overwrite a live message. Appending is not tidiness — a trigger that can be erased by
  // an unrelated trigger is a check that stops reporting for a reason nobody can see from the
  // output, which is `workflow.md` §11a's whole subject.
  //
  // *** A FUNCTION DECLARATION RATHER THAN A `const` ARROW, DELIBERATELY: it is HOISTED, so the
  // `0039` phase-3 trigger a hundred lines ABOVE can call it. *** A `const` there would be a
  // temporal-dead-zone throw at the exact moment the trigger fires — which is to say, only on the
  // runs where it matters, and never on a green one.
  function raiseMigrationNotice(text) {
    report.migrationNotice =
      report.migrationNotice === undefined ? text : `${report.migrationNotice}\n\nAND SEPARATELY:\n${text}`;
  }

  if (!ENUM_POLICY_REQUIRED && report.population.enumsLackingPolicy === 0 && report.population.enumsExamined > 0) {
    if (corpusShapes.unparseable > 0) {
      // A THIRD OUTCOME WITH ITS OWN MESSAGE, rather than a total that quietly cannot be trusted.
      raiseMigrationNotice(
        `${corpusShapes.unparseable} schema(s) could not be parsed, so the corpus enum total ` +
        `(${corpusShapes.enums}) is A LOWER BOUND and phase 2 of docs/decisions/0041 CANNOT BE ` +
        'ASSESSED. This is not "the migration is incomplete" and not "it is due" — it is that the ' +
        'question cannot be answered. Fix the unreadable schema first; buildSchemaIndex names it.',
      );
    } else if (report.population.enumsExamined === report.population.enumsInCorpus) {
      raiseMigrationNotice(
        `Every enum declares an \`enumPolicy\` (${report.population.enumsExamined} examined, ` +
        `${report.population.enumsInCorpus} in the corpus, 0 lacking), and ENUM_POLICY_REQUIRED is ` +
        'still false. Phase 2 of docs/decisions/0041 is due: set it to true so an undeclared enum ' +
        'becomes a refusal. A deliberate stop, not a defect.',
      );
    } else {
      // DISTINGUISHABLE FROM "DUE", deliberately. "Every enum I looked at is declared" and "every
      // enum is declared" are different claims, and only the second licenses phase 2.
      raiseMigrationNotice(
        `Every enum the generator REACHED declares a policy (${report.population.enumsExamined} of ` +
        `${report.population.enumsInCorpus} in the corpus), BUT PHASE 2 IS NOT DUE and this is a ` +
        `different state from being due. ${report.population.enumsInCorpus - report.population.enumsExamined} ` +
        'SHAPE enum(s) live in schemas no admitted contract references — the registry schemas — so ' +
        'the emitter never opens them and their policies are unasserted. Requiring the field now ' +
        'would claim a migration over a corpus this tool did not examine. ' +
        `(${report.population.constraintEnumsInCorpus} constraint-position enum(s) are EXCLUDED ` +
        'from both figures BY DESIGN and are not part of this gap: they emit no type, so a policy ' +
        'on one would govern nothing. Counting them here is what made this comparison unsatisfiable ' +
        'until 2026-09-10.)',
      );
    }
  }

  // ---- THE SAME TRIGGER FOR VARIANT SETS, AND IT IS NOT THE SAME CONDITION.
  //
  // `oneOfsInCorpus` counts `oneOf` OCCURRENCES and cannot say how many are variant sets, because
  // classifying needs `$ref` resolution (see countCorpusShapes). So the reached-versus-corpus
  // comparison that gates the enum flip has no equivalent here, and pretending otherwise would be
  // a gate that compares a classified count against an unclassified one — two numbers that are not
  // the same kind of thing, agreeing or disagreeing for reasons nobody could read.
  //
  // WHAT IS ASSERTED INSTEAD IS THE HONEST WEAKER THING: every variant set the emitter reached is
  // declared, AND the emitter reached every `oneOf` in the corpus. The second half is what makes it
  // safe, and it is checkable — an unreached `oneOf` is an unclassified one.
  if (!VARIANT_POLICY_REQUIRED && report.population.variantSetsLackingPolicy === 0 && report.population.variantSetsExamined > 0) {
    const oneOfsClassified = Object.values(report.population.oneOfsByKind).reduce((a, b) => a + b, 0);
    if (corpusShapes.unparseable > 0) {
      raiseMigrationNotice(
        `${corpusShapes.unparseable} schema(s) could not be parsed, so the corpus \`oneOf\` total ` +
        `(${corpusShapes.oneOfs}) is A LOWER BOUND and the variant-set half of docs/decisions/0041 ` +
        'CANNOT BE ASSESSED.',
      );
    } else if (oneOfsClassified === report.population.oneOfsInCorpus) {
      raiseMigrationNotice(
        `Every \`oneOf\` variant set declares an \`enumPolicy\` (${report.population.variantSetsExamined} ` +
        `variant set(s) among ${oneOfsClassified} \`oneOf\`(s) classified, ${report.population.oneOfsInCorpus} ` +
        'in the corpus, 0 lacking), and VARIANT_POLICY_REQUIRED is still false. The variant-set ' +
        'phase 2 is due: set it to true so an undeclared variant set becomes a refusal.',
      );
    } else {
      raiseMigrationNotice(
        `Every variant set the generator REACHED declares a policy (${report.population.variantSetsExamined} ` +
        `reached), BUT THE VARIANT PHASE 2 IS NOT DUE. ${report.population.oneOfsInCorpus - oneOfsClassified} ` +
        `of the corpus's ${report.population.oneOfsInCorpus} \`oneOf\`(s) were never classified — they ` +
        'live in schemas no admitted contract references, so whether any of them is a variant set is ' +
        'UNKNOWN rather than answered. Requiring the field now would claim a migration over shapes ' +
        'this tool did not examine.',
      );
    }
  }

  return report;
}

function formatReport(report) {
  const p = report.population;
  // Derived from the per-kind counts rather than carried as its own field, so the total and the
  // breakdown cannot disagree. Two numbers from one place; `workflow.md` §11a's transcription rule
  // applied to a report line.
  const byKind = p.oneOfsByKind ?? newOneOfKindCounts();
  const oneOfsClassified = ONEOF_KINDS.reduce((sum, kind) => sum + byKind[kind], 0);
  const lines = [
    `mode: ${report.mode}`,
    '',
    'POPULATION EXAMINED, against an independently derived total:',
    `  contract files found on disk .......... ${p.contractFilesFound}`,
    `  schema files found on disk ............ ${p.schemaFilesFound} (${p.schemasWithoutContract} with no contract beside them: common/ and registries/)`,
    `  contracts admitted .................... ${p.contractsAdmitted}`,
    `  contracts REFUSED ..................... ${p.contractsRefused}`,
    `  modules ${report.mode === 'check' ? 'compared' : 'emitted'} ..................... ${p.modulesEmitted}`,
    `    of which SHARED (common/, registries/) ${p.sharedModulesEmitted} — emitted because an admitted contract imports them`,
    `  shared schemas REACHED by the closure .. ${p.sharedSchemasReached ?? 0}` +
      ((p.sharedSchemasReached ?? 0) === 0
        ? '  *** ZERO: the shared-closure reconciliation below examined nothing and passed vacuously ***'
        : ''),
    '',
    'docs/decisions/0039 — requestClass migration:',
    `  contracts DECLARING requestClass ...... ${p.contractsDeclaringRequestClass}`,
    `  contracts still LACKING it ............ ${p.contractsLackingRequestClass}` +
      (p.contractsLackingRequestClass > 0 ? '  (phase 1: warning, vocabulary falls back to the block key)' : ''),
    `  publishing NO operations (exempt) ..... ${p.contractsPublishingNoOperations} — a class is a property of a route; these have none`,
    '',
    'docs/decisions/0041 — enumPolicy migration:',
    // PRINTED EVEN WHEN ZERO. This is the population the corpus total DELIBERATELY EXCLUDES, and an
    // excluded population that is never shown is a narrowing nobody audits. A number moving here is
    // a finding: it means a predicate gained or lost an enum, which nothing else in this report
    // would say.
    `  constraint-position enums (EXCLUDED) .. ${p.constraintEnumsInCorpus ?? 'not derived'}` +
      '  — inside `not`/`if`/`then`/`else`; they emit no type, so a policy would govern nothing',
    `  enums IN THE CORPUS (independent) ..... ${p.enumsInCorpus ?? 'not derived'}` +
      ((p.unparseableSchemas ?? 0) > 0
        ? `  *** LOWER BOUND: ${p.unparseableSchemas} schema(s) unparseable, so this total is incomplete ***`
        : ''),
    `  enums EXAMINED by the emitter ......... ${p.enumsExamined}` +
      (p.enumsExamined === 0
        ? '  *** ZERO: no enum was read, which is not the same as none lacking a policy ***'
        : p.enumsInCorpus !== undefined && p.enumsExamined !== p.enumsInCorpus
          ? `  *** ${p.enumsInCorpus - p.enumsExamined} UNREACHED — in schemas no admitted contract references; their policies are unasserted ***`
          : ''),
    `  enums LACKING a policy ................ ${p.enumsLackingPolicy}` +
      (p.enumsLackingPolicy > 0
        ? '  (phase 1: WARNING only — the emitted type is unchanged, so no consumer breaks)'
        : ''),
    '',
    'docs/decisions/0041 extended — `oneOf` variant sets:',
    `  \`oneOf\`s IN THE CORPUS (independent) ... ${p.oneOfsInCorpus ?? 'not derived'}` +
      ((p.unparseableSchemas ?? 0) > 0
        ? `  *** LOWER BOUND: ${p.unparseableSchemas} schema(s) unparseable ***`
        : ''),
    `  \`oneOf\`s CLASSIFIED by the emitter .... ${oneOfsClassified}` +
      (oneOfsClassified === 0
        ? '  *** ZERO: no `oneOf` was classified, which is not the same as none needing a policy ***'
        : p.oneOfsInCorpus !== undefined && oneOfsClassified !== p.oneOfsInCorpus
          ? `  *** ${p.oneOfsInCorpus - oneOfsClassified} UNREACHED — whether any is a variant set is UNKNOWN ***`
          : ''),
    // ---- EVERY KIND, INCLUDING THE ZEROES, AND THAT IS THE POINT OF PRINTING IT AS A LIST.
    //
    // This is the skip-set made visible. `classifyOneOf` decides which `oneOf`s the policy
    // requirement never reaches, and a skip-set that is not printed is one nobody audits. A count
    // moving from 31 to 30 with no other change is a `oneOf` that stopped being a nullable wrapper.
    ...ONEOF_KINDS.map(
      (kind) =>
        `    ${kind.padEnd(24, '.')}... ${byKind[kind]}` +
        (kind === 'variant-set' ? '  <- the only kind a policy is required on' : '') +
        ((kind === 'undiscriminated-object' || kind === 'ambiguous-discriminant') && byKind[kind] > 0
          ? '  *** REFUSED ***'
          : ''),
    ),
    `  variant sets LACKING a policy ......... ${p.variantSetsLackingPolicy}` +
      (p.variantSetsLackingPolicy > 0
        ? '  (phase 1: WARNING only — the emitted type is unchanged, so no consumer breaks)'
        : ''),
  ];
  if (report.mode === 'check') lines.push(`  modules DRIFTED ....................... ${p.modulesDrifted}`);
  lines.push(
    '',
    `  admitted + refused = ${p.contractsAdmitted + p.contractsRefused}, and it must equal ${p.contractFilesFound}.` +
      (p.contractsAdmitted + p.contractsRefused === p.contractFilesFound ? ' OK' : ' *** MISMATCH ***'),
  );
  // FATAL and MIGRATION are rendered under DIFFERENT WORDS, not one label with two meanings — the
  // whole point of the exit-code split is that "the corpus is wrong" and "a decision is due" are
  // different states, and a reader who sees `FATAL` on a clean corpus learns the wrong thing.
  if (report.fatal !== undefined) lines.push('', `FATAL: ${report.fatal}`);
  if (report.migrationNotice !== undefined) {
    lines.push(
      '',
      `MIGRATION (exit 3 — nothing is broken, a decision is due): ${report.migrationNotice}`,
    );
  }
  // ---- PRINTED UNCONDITIONALLY. THE GUARD THAT WAS HERE DEFEATED THE MARKER INSIDE IT.
  //
  // This block was wrapped in `if (report.refusals.length > 0)`, so on a clean corpus it printed
  // NOTHING — and **"every category is zero" and "the classification code did not run" rendered
  // identically.** That is the exact shape the zero-legibility marker was added to prevent,
  // defeated by the condition wrapping it: the marker can only speak if the block executes.
  //
  // A clean run is the outcome, not the absence of a result, and it should say so.
  {
    // ---- COMPOSITION BEFORE THE LIST. `qa-agent`'s tally, adopted because it caught something a
    // total cannot: **A SET THAT CHANGES COMPOSITION WHILE KEEPING ITS SIZE READS AS UNCHANGED.**
    // Across four runs this report printed "14 refusals" and only an external by-code tally could
    // say whether they were the SAME fourteen. That is `workflow.md` §11a's population rule applied
    // to findings rather than to inputs, and it belongs in the report rather than in the verifier.
    //
    // Split by family too, because the prefix decides who a refusal is addressed to: `MISSING_*`
    // sends a reader to edit a CONTRACT, every other code sends them to fix THIS TOOL.
    const byCode = new Map();
    for (const r of report.refusals) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1);
    const tally = { contract: 0, generator: 0, derived: 0 };
    for (const r of report.refusals) tally[REFUSAL_AUTHOR[r.code] ?? 'generator'] += 1;

    // A ZERO IS PRINTED AS A FACT, NOT LEFT AS AN ABSENCE. A side that is always empty on the real
    // corpus and a split that never fired look identical, which is the vacuity shape arriving in
    // the REPORT rather than in a check. The generator side has never been non-empty here; its
    // value is prospective, and saying so is what keeps a future non-zero legible as news.
    const side = (n, noun) =>
      n === 0 ? `NONE ${noun} (this side is empty on this corpus — prospective, not silent)` : `${n} ${noun}`;
    lines.push(
      '',
      `REFUSALS (${report.refusals.length}) — ${side(tally.contract, 'name a CONTRACT deficiency')}; ${side(tally.generator, 'name a defect in THIS GENERATOR')}; ${tally.derived} derived (a consequence of another refusal, counted on neither side):`,
    );
    for (const [code, count] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${String(count).padStart(3)} × ${code}`);
    }
    if (report.refusals.length > 0) {
      lines.push('');
      for (const r of report.refusals) lines.push(`  [${r.code}] ${r.contract}: ${r.message}`);
    }
  }
  if (report.drift.length > 0) {
    lines.push('', `DRIFT (${report.drift.length}):`);
    for (const d of report.drift) lines.push(`  ${d.path}: ${d.reason}`);
  }
  if (report.warnings.length > 0) {
    lines.push('', `WARNINGS (${report.warnings.length}) — not refusals:`);
    for (const w of report.warnings) lines.push(`  ${w.contract ?? '-'}: ${w.message}`);
  }
  return lines.join('\n');
}

/**
 * ===========================================================================================
 * FOUR CODES, AND `3` EXISTS BECAUSE "THE CORPUS IS WRONG" AND "A MIGRATION IS DUE" WERE ONE
 * ===========================================================================================
 *
 *   0  nothing to say
 *   1  the corpus is wrong in a way a contract author fixes — refusals, or drift
 *   2  the corpus is wrong in a way THIS TOOL's own accounting cannot survive — an empty walk, a
 *      split that does not reconcile, a shared/contract misclassification
 *   3  *** THE CORPUS IS FINE AND A MIGRATION HAS REACHED A PHASE BOUNDARY. *** Nothing is broken.
 *      Somebody has to make a decision.
 *
 * *** WHY THIS SPLIT, AND WHAT IT COST TO NOT HAVE IT. *** `--check` exited 2 on two "PHASE 2 IS
 * NOT DUE" notices while reporting 16 admitted, 0 refused, 0 drift. That is a correct, deliberate
 * stop CONFLATED WITH FAILURE — so `--check` could not join `npm test` (*a red gate folded into a
 * green one makes the green one worthless*), the drift comparison was run BY HAND all day, and the
 * one time it was not, a stale module sat there until somebody looked.
 *
 * *** AND THE FIX IS NOT TO MAKE THE NOTICE EXIT 0. *** A trigger that prints loudly and exits 0
 * inside a gate is one line in a passing run's output. `check:source-bytes` is the precedent going
 * the other way: it stayed OUT of the gate specifically so it could keep a non-zero exit and mean
 * something. A phase boundary is a standing instruction to change this generator, which is exactly
 * the class this repository keeps finding rotted in prose nothing enforces.
 *
 * *** THE PART THAT MATTERS MOST AND IS NOT IN THIS FUNCTION: `--check` STILL DOES NOT JOIN THE
 * GATE, AND `npm test` MUST NOT SPECIAL-CASE `3`. *** Ruled by the Team Lead, 2026-09-10, and it
 * closes a gap in the argument above: treating 3 as pass-with-a-notice inside the gate makes the
 * notice invisible in precisely the place the non-zero exit was protecting it from — one line in a
 * passing run. And `node … --check || [ $? -eq 3 ]` puts exit-code arithmetic in a shell chain,
 * which is `workflow.md` §11a's *the exit code is the result*, in the construct that has burned
 * this session three times.
 *
 *   > **EXIT CODES ARE FOR HUMANS RUNNING A TOOL. SUITE ASSERTIONS ARE FOR GATES. Both of us were
 *   > trying to make one thing do both jobs.**
 *
 * So the gate gets SUITE CASES instead — `qa-agent` asserts the phase condition directly, and the
 * day it holds the case goes RED and names the constant to flip; and asserts zero drifted modules,
 * which puts the hand-run comparison behind something that fails. A red suite case is a stop nobody
 * scrolls past; an exit code in a command nobody runs is not.
 *
 * ORDER IS PRECEDENCE AND CORPUS PROBLEMS WIN. A run with refusals AND a phase notice exits 1: the
 * migration question is not answerable over a corpus that did not read, and reporting `3` there
 * would announce a decision is due on evidence that is missing.
 *
 * *** EXPORTED 2026-09-10 SO THE PRECEDENCE CAN BE ASSERTED RATHER THAN RE-IMPLEMENTED. *** It was
 * module-private, so a suite could only reach it by running the real corpus in a subprocess and
 * reading the process's exit code — which asserts ONE RUN over ONE INPUT and says nothing about the
 * rule. `qa-agent` declined to write a second copy of the precedence in its own file and was right
 * to: *a second copy of a precedence rule agrees silently until it does not*, which is
 * `workflow.md` §12's duplicated constraint with an ordering attached.
 *
 * THE INTERESTING INPUTS ARE THE ONES A REAL CORPUS CANNOT PRODUCE ON DEMAND — refusals AND a phase
 * notice together, drift AND a notice, a reconciliation mismatch — and every one of them is a
 * constructed `report` object away once this is callable. Same reasoning as `refusalAuthorFor`:
 * bind the assertion to the running rule, not to a run of it.
 */
export function exitCodeFor(report) {
  if (report.fatal !== undefined) return 2;
  if (report.refusals.length > 0) return 1;
  if (report.mode === 'check' && report.population.modulesDrifted > 0) return 1;
  if (report.population.contractsAdmitted + report.population.contractsRefused !== report.population.contractFilesFound) {
    return 2;
  }
  if (report.migrationNotice !== undefined) return 3;
  return 0;
}

/**
 * THE KNOWN-FAILING INPUT. `0037` requirement 3, and `workflow.md` §11a's remedy:
 * "constructing the input the check should fail on is the only thing that distinguishes
 * sound-by-design from sound-by-accident, because both look identical while passing."
 *
 * It runs `--check` over the drift fixture — `packages/testing/fixtures/contract-generator/drift/`,
 * resolved below — whose committed output is DELIBERATELY STALE, and it FAILS IF THE CHECK PASSES.
 * A negative control that cannot fail is not a control.
 *
 * *** THIS SENTENCE SAID `fixtures/drift/` UNTIL 2026-09-09, WHILE THE CODE FIVE LINES DOWN HAD
 * ALREADY BEEN REPOINTED. *** `architecture.md` §3c at the shortest possible range: a comment
 * naming a location its own function contradicts. It survived because the path moved and the
 * prose describing it did not — and a reader checking the comment against the corpus would have
 * gone to a directory that no longer exists rather than to the one being read.
 */
function selfTest() {
  // ===========================================================================================
  // THE FIXTURE LIVES IN `packages/testing/**` AND NOT BESIDE THIS FILE. `docs/decisions/0040`.
  // ===========================================================================================
  //
  // `packages/contracts/**` holds published contracts, their registries, and the tools that read
  // them — **and no deliberately-malformed input, ever.** A fixture that exists to contain a broken
  // shape is TOOL INPUT, not a published contract, and a checker globbing `*.contract.yaml` cannot
  // tell the difference. The precedent was already set by `0009`: its validator lives here, its 26
  // fixtures live in `packages/testing/fixtures/**`.
  //
  // *** THE `drift/` LEVEL IS LOAD-BEARING AND MUST NOT BE FLATTENED. ***
  // `qa-agent`'s cascade tree occupies `contract-generator/` alongside this. Each tool walks its
  // root RECURSIVELY, so two fixture sets sharing one root means every run discovers the other's
  // contracts: rooted one level up, this self-test would find five contracts instead of one and the
  // cascade suite would find one extra. The directory level is the only thing preventing it —
  // `walk()` skips `generated` and `fixtures` BY NAME and would not skip either tree.
  const fixtureRoot = join(HERE, '..', '..', 'testing', 'fixtures', 'contract-generator', 'drift');

  // ---- THE OLD LOCATION MUST BE GONE, AND THIS IS WHY THAT IS CHECKED RATHER THAN REMEMBERED.
  //
  // While a copy remains at the old path, a green self-test proves nothing about which copy ran:
  // both are byte-identical and either would pass. **That is the alarming-green window** — and it
  // cannot be closed by intending to delete, because the intention leaves no trace that fails.
  // Asserting the absence turns "somebody still has to delete the originals" from an invisible
  // state into a red run that names the files.
  const retiredRoot = join(HERE, 'fixtures');
  if (existsSync(retiredRoot)) {
    console.error(
      `SELF-TEST FAILED: the retired fixture directory still exists at ${retiredRoot}.\n` +
        '  The fixture moved to packages/testing/fixtures/contract-generator/drift/ under 0040.\n' +
        '  Two byte-identical copies mean a green run cannot say which one it read, so this is\n' +
        '  RED until the originals are deleted. Delete them; this check then passes on its own.',
    );
    return 1;
  }

  if (!existsSync(fixtureRoot)) {
    console.error(`SELF-TEST FATAL: no fixture at ${fixtureRoot}. The negative control is missing, which means the drift check has never been shown to fail.`);
    return 2;
  }
  const report = run({ mode: 'check', root: fixtureRoot, outputRoot: join(fixtureRoot, 'generated') });
  const detected = report.population.modulesDrifted > 0;
  console.log(formatReport(report));
  console.log('');
  if (detected) {
    console.log('SELF-TEST PASSED: the drift check went RED on deliberately stale committed output.');
    return 0;
  }
  console.error(
    'SELF-TEST FAILED: the fixture output is deliberately stale and the check did not notice. ' +
      'The drift check is not detecting drift, and every green run it has ever produced means nothing.',
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const args = new Set(process.argv.slice(2));
  if (args.has('--self-test')) {
    process.exit(selfTest());
  } else {
    const report = run({ mode: args.has('--check') ? 'check' : 'emit' });
    console.log(formatReport(report));
    process.exit(exitCodeFor(report));
  }
}
