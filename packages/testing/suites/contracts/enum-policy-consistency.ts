/**
 * ===========================================================================================
 * TWO ENUMS WITH THE SAME VALUES MUST CARRY THE SAME `enumPolicy`. `docs/decisions/0041`.
 * ===========================================================================================
 *
 * `0041` gives every enum its own policy, and **the same wire field is defined in several
 * contracts.** `platformRole` — `["marketplace-moderator","platform-admin"]` — is defined in
 * **three** schemas; the Organization status set in **two**; the error-code taxonomy in **two**.
 *
 * > **So three copies can carry three policies and emit three different client types for ONE wire
 * > field.** Nothing else would notice: each copy is internally valid, the generator emits each
 * > faithfully, and the divergence appears only in what a consumer is allowed to do with a value
 * > the server may send.
 *
 * **The prose had already diverged before the policies existed** — one copy of the status set is
 * described as *"closed"* and the other says nothing — which is what a duplicated constraint always
 * does (`workflow.md` §12: *the rule was restated six times and agreed with the running code once*).
 *
 * ===========================================================================================
 * WHY A CHECK RATHER THAN COLLAPSING THE COPIES TO `$ref`s
 * ===========================================================================================
 *
 * Collapsing is the eventual fix and is deliberately **not** happening yet: it would move emitted
 * types under `web-agent` mid-swap, which is the disruption `0041` phase 1 exists to avoid.
 *
 * **But this check is not throwaway work ahead of that pass — it is STRICTLY STRONGER.** A `$ref`
 * unifies enums somebody already noticed and wired together. **This catches two enums that are
 * semantically the same and were NEVER wired at all**, which is the case nobody is looking for,
 * and it keeps working after every collapse anyone gets round to.
 *
 * ===========================================================================================
 * WHAT FAILS, AND WHAT DELIBERATELY DOES NOT
 * ===========================================================================================
 *
 *   FAIL    two enums with identical value sets carrying DIFFERENT policies — including one
 *           declared and one not. **Undeclared is a state, not a policy**, and a half-declared
 *           set is exactly how `platformRole` looked an hour before this file existed.
 *   PASS    a duplicated value set where NO copy is declared. That is `0041` phase 1's normal
 *           condition and failing on it would make the check red for the whole migration —
 *           the refusal-on-arrival mistake phase 1 exists to avoid.
 *   PASS    a value set appearing once, whatever it declares. Nothing to be inconsistent with.
 *
 * ===========================================================================================
 * *** ONE LEGITIMATE DISAGREEMENT IS COMING, AND IT MUST NOT BE ANSWERED WITH AN ALLOWLIST ***
 * ===========================================================================================
 *
 * `0041` amendment 1 rules that **a REQUEST enum is `closed` even when the response enum over the
 * same vocabulary is `extensible`** — `extensible` is a claim about what the SERVER may send, and
 * on a request field it would promise exactly what the route refuses. **So one value set may
 * legitimately carry two policies, and this check will one day go red on a correct pair.**
 *
 * **That red is the correct outcome and the repair is NOT an allowlist keyed on the pair.** A
 * documented failure someone has to look at beats a list that silently grows: an allowlist entry
 * is indistinguishable from a suppression six months later, and this check exists because a
 * duplicated constraint drifted while every copy looked locally fine. **When it fires, read both
 * `$comment`s — `architecture-agent` is instructed to state the direction in each — and if they
 * genuinely differ by direction, record THAT as the resolution rather than silencing the pair.**
 *
 * ===========================================================================================
 * AND THERE ARE TWO CHECKS HERE, NOT ONE. NEITHER SUBSUMES THE OTHER.
 * ===========================================================================================
 *
 * This case groups by **identical values** and guards the **policies**. The case below it groups
 * by **`$defs` name** and guards the **values** — and the second exists because divergence is
 * exactly the condition that removes a copy from the first one's comparison. **A copy whose values
 * drift becomes a singleton and silently leaves the group this case examines.** See that case's
 * header for the constructed input, and do not delete either as a duplicate of the other.
 *
 * **RUN AGAINST THE BROKEN STATE FIRST, and it was worth it.** At the moment this file was
 * written the corpus held **38 enums across 13 files with 9 declared**, and the walk found two
 * live disagreements — then, minutes later, a third that had not existed when the first was
 * measured. `§11a`: *the real broken state contains the failures you did not think of, and it
 * exists for free, once, and only until you repair it.*
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ISOLATION, Suite, assertEqual, assertTrue } from '../../harness/runner.ts';

const CONTRACTS = fileURLToPath(new URL('../../../contracts/', import.meta.url));

/** One node carrying an `enum`, wherever it sits. */
export type EnumOccurrence = {
  readonly file: string;
  readonly pointer: string;
  /** Sorted, so two declarations of one set compare equal whatever order they were written in. */
  readonly values: readonly string[];
  /** `undefined` means UNDECLARED, which is a state and not a policy. */
  readonly policy: string | undefined;
  /** `0041`'s on-artifact exemption. See `divergenceExemption` for what makes one valid. */
  readonly divergence: { readonly counterpart?: unknown; readonly reason?: unknown } | undefined;
};

/**
 * ===========================================================================================
 * *** A DIVERGENCE EXEMPTION IS A TWO-FILE ACT WITH A NAMED COUNTERPART, NEVER A SELF-SERVICE
 * *** SUPPRESSION. THAT REQUIREMENT CARRIES THE WHOLE SAFETY PROPERTY.
 * ===========================================================================================
 *
 * `0041` amendment 1 makes one legitimate disagreement possible: **`extensible` is a claim about
 * what the SERVER sends, so a request enum is `closed` even when the response enum over the same
 * vocabulary is `extensible`.** `templateStatus` / `templateStatusFilter` is that pair.
 *
 * **The exemption lives on the schema rather than in a list here**, which is the point: it is
 * readable by anyone opening the file, it names its counterpart, and it is machine-checkable.
 *
 * *** IF ONE SIDE COULD EXEMPT ITSELF, THIS CHECK WOULD BE WORSE THAN NOT EXISTING. *** Somebody
 * silencing a genuine drift would need to touch only the file they already had open — the marker
 * becomes a suppression that costs nothing and reads as documentation. **Requiring BOTH sides, each
 * naming the other, makes an exemption a deliberate act in two places with a stated reason.**
 *
 * So a group is exempt only when **every** member satisfies all four:
 *
 *   1. it declares `enumPolicyDivergence` at all;
 *   2. its `counterpart` is a local `#/$defs/<name>` pointer that RESOLVES to another member of
 *      the same group — not to a missing def, and not to some third thing;
 *   3. that counterpart POINTS BACK at it, so the relation is symmetric;
 *   4. its `reason` is a non-empty string. **An exemption with no stated reason is an allowlist
 *      row wearing a schema's clothes.**
 *
 * **Anything short of all four is reported as a FAULT rather than silently ignored**, because a
 * malformed exemption that merely fails to exempt would leave the original disagreement red with
 * no explanation of why the marker did not take.
 */
function divergenceExemption(group: readonly EnumOccurrence[]): {
  exempt: boolean;
  faults: readonly string[];
} {
  const faults: string[] = [];
  const nameOf = (pointer: string): string | null =>
    pointer.startsWith('#/$defs/') && !pointer.slice('#/$defs/'.length).includes('/')
      ? pointer.slice('#/$defs/'.length)
      : null;
  const declared = group.filter((entry) => entry.divergence !== undefined);
  if (declared.length === 0) return { exempt: false, faults };

  // ---- REQUIREMENT 1, AND IT IS THE ONE THAT MATTERS. A partial declaration is the shape a
  // self-service suppression takes, so it is named explicitly rather than merely not exempting.
  if (declared.length !== group.length) {
    const missing = group.filter((entry) => entry.divergence === undefined);
    faults.push(
      `ONE-SIDED EXEMPTION: ${declared.map((e) => `${e.file}${e.pointer}`).join(', ')} ` +
        `declare(s) \`enumPolicyDivergence\` and ${missing.map((e) => `${e.file}${e.pointer}`).join(', ')} ` +
        'do(es) not. An exemption must be declared on BOTH sides — a one-sided marker is a ' +
        'suppression the other file never agreed to.',
    );
    return { exempt: false, faults };
  }

  // ---- THE POLICIES MUST BE EXACTLY ONE `extensible` AND ONE `closed`.
  //
  // **`0041` amendment 1 licenses ONE shape and no other: a response enum that is `extensible`
  // beside a request enum that is `closed`.** A marker between two `closed` defs, or two
  // `extensible` ones, is not that case — it is **two enums disagreeing about nothing with an
  // exemption attached**, and honouring it would let the marker silence a pair the amendment says
  // nothing about. The exemption is scoped to the shape it was created for.
  const policies = group.map((entry) => String(entry.policy)).sort();
  if (policies.length !== 2 || policies[0] !== 'closed' || policies[1] !== 'extensible') {
    faults.push(
      `NOT AMENDMENT 1'S SHAPE: the policies are [${policies.join(', ')}]. A declared divergence ` +
        'licenses exactly one `extensible` (the response) beside one `closed` (the request). Any ' +
        'other combination is not what 0041 amendment 1 permits, and the marker does not silence it.',
    );
    return { exempt: false, faults };
  }

  for (const entry of group) {
    const divergence = entry.divergence!;
    const where = `${entry.file}${entry.pointer}`;
    if (typeof divergence.reason !== 'string' || divergence.reason.trim() === '') {
      faults.push(`${where}: \`enumPolicyDivergence.reason\` is missing or empty.`);
    }
    const counterpartName =
      typeof divergence.counterpart === 'string' ? nameOf(divergence.counterpart) : null;
    if (counterpartName === null) {
      faults.push(
        `${where}: \`counterpart\` is not a local \`#/$defs/<name>\` pointer ` +
          `(${JSON.stringify(divergence.counterpart)}).`,
      );
      continue;
    }
    const target = group.find(
      (other) => other.file === entry.file && other.pointer === `#/$defs/${counterpartName}`,
    );
    if (target === undefined) {
      faults.push(
        `${where}: \`counterpart\` names \`${counterpartName}\`, which is not an enum sharing this ` +
          'value set in the same file.',
      );
      continue;
    }
    const backName =
      typeof target.divergence?.counterpart === 'string'
        ? nameOf(target.divergence.counterpart)
        : null;
    if (backName === null || `#/$defs/${backName}` !== entry.pointer) {
      faults.push(
        `${where}: \`${counterpartName}\` does not point back at it — the exemption is not mutual.`,
      );
    }
  }
  return { exempt: faults.length === 0, faults };
}

/**
 * Every `enum` node in the published contract set.
 *
 * **`generated/` and `generator/` are excluded and neither is a judgement call.** `generated/`
 * holds this generator's own TypeScript output — asserting a property of a schema against a copy
 * derived from it is comparing a thing with itself. `generator/` holds tooling and no schemas at
 * all today; it is named so that a schema appearing there later is a deliberate decision rather
 * than a silent inclusion.
 */
export function enumOccurrences(root: string): EnumOccurrence[] {
  const found: EnumOccurrence[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'generated' && entry.name !== 'generator') walk(`${path}/`);
        continue;
      }
      if (!entry.name.endsWith('.schema.json')) continue;
      const relative = path.slice(root.length);
      const visit = (node: unknown, pointer: string): void => {
        if (Array.isArray(node)) {
          node.forEach((entryValue, index) => visit(entryValue, `${pointer}/${String(index)}`));
          return;
        }
        if (node === null || typeof node !== 'object') return;
        const record = node as Record<string, unknown>;
        if (Array.isArray(record['enum'])) {
          found.push({
            file: relative,
            pointer,
            values: (record['enum'] as unknown[]).map(String).sort(),
            policy: typeof record['enumPolicy'] === 'string' ? record['enumPolicy'] : undefined,
            divergence:
              typeof record['enumPolicyDivergence'] === 'object' &&
              record['enumPolicyDivergence'] !== null
                ? (record['enumPolicyDivergence'] as { counterpart?: unknown; reason?: unknown })
                : undefined,
          });
        }
        for (const [key, value] of Object.entries(record)) visit(value, `${pointer}/${key}`);
      };
      visit(JSON.parse(readFileSync(path, 'utf8')), '#');
    }
  };
  walk(root);
  return found;
}

/** One `$defs` entry that IS an enum, keyed by the vocabulary name it was given. */
export type NamedEnumDef = {
  readonly file: string;
  readonly name: string;
  readonly values: readonly string[];
};

/**
 * Every **top-level `$defs` entry** carrying an `enum`, across the corpus.
 *
 * *** SCOPED TO NAMED `$defs` ENTRIES ON PURPOSE, AND THE ALTERNATIVE IS WORSE. *** Keying on the
 * last pointer segment would group every inline `properties/status` enum in the corpus under
 * `status` — and two unrelated `status` enums having different values is **correct**, so the check
 * would be red on legitimate input from its first run. **A named `$def` is a deliberate vocabulary
 * term; an inline enum on a property is not**, and only the first carries a claim that two files
 * mean the same thing by one word.
 */
export function namedEnumDefs(root: string): NamedEnumDef[] {
  const found: NamedEnumDef[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'generated' && entry.name !== 'generator') walk(`${path}/`);
        continue;
      }
      if (!entry.name.endsWith('.schema.json')) continue;
      const document = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      const defs = (document['$defs'] ?? {}) as Record<string, unknown>;
      for (const [name, definition] of Object.entries(defs)) {
        const values = (definition as Record<string, unknown>)['enum'];
        if (!Array.isArray(values)) continue;
        found.push({ file: path.slice(root.length), name, values: values.map(String).sort() });
      }
    }
  };
  walk(root);
  return found;
}

/** Groups of occurrences sharing one value set, in file order. */
function byValueSet(occurrences: readonly EnumOccurrence[]): Map<string, EnumOccurrence[]> {
  const groups = new Map<string, EnumOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = JSON.stringify(occurrence.values);
    const group = groups.get(key) ?? [];
    group.push(occurrence);
    groups.set(key, group);
  }
  return groups;
}

export function buildEnumPolicyConsistencySuite(): Suite {
  const suite = new Suite('Contracts — one value set, one enumPolicy (0041)');

  suite.test('*** IDENTICAL ENUM VALUE SETS CARRY IDENTICAL POLICIES ***', () => {
    const occurrences = enumOccurrences(CONTRACTS);

    // ===================================================================================
    // THE POPULATION, AGAINST AN INDEPENDENT DERIVATION — and the reason it is not the
    // generator's count.
    // ===================================================================================
    //
    // The `0037` generator reaches **21** of these enums, because 17 sit in registry schemas no
    // contract references. **A check counting only what the generator reaches would pass over 55%
    // of the corpus it never saw** — and a duplicated value set is most likely to hide exactly
    // there, in the schemas nothing pulls in.
    //
    // So the count is taken from the schema FILES on disk, and reconciled against a second
    // derivation that shares nothing with the walk: a textual count of `"enum":` keys. A walk that
    // stopped descending would disagree with the text; today they agree.
    const textual = (() => {
      let count = 0;
      const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = `${directory}${entry.name}`;
          if (entry.isDirectory()) {
            if (entry.name !== 'generated' && entry.name !== 'generator') walk(`${path}/`);
          } else if (entry.name.endsWith('.schema.json')) {
            count += (readFileSync(path, 'utf8').match(/"enum"\s*:/gu) ?? []).length;
          }
        }
      };
      walk(CONTRACTS);
      return count;
    })();

    const files = new Set(occurrences.map((occurrence) => occurrence.file));
    const declared = occurrences.filter((occurrence) => occurrence.policy !== undefined);
    const groups = byValueSet(occurrences);
    const duplicated = [...groups.values()].filter((group) => group.length > 1);

    console.log(
      `        enum policy: ${String(occurrences.length)} enums in ${String(files.size)} files · ` +
        `${String(declared.length)} declared · ${String(groups.size)} distinct value sets · ` +
        `${String(duplicated.length)} appearing more than once`,
    );

    // ---- THE FLOOR. Each clause names a different way of comparing nothing with nothing.
    assertEqual(
      `${ISOLATION} the structural walk and a textual count agree on how many enums exist`,
      String(occurrences.length),
      String(textual),
    );
    assertTrue(
      `${ISOLATION} the walk found a substantial enum population`,
      occurrences.length >= 25,
      `only ${String(occurrences.length)} enums were found; there were 38 on 2026-09-09. **TWO ` +
        'ENUMS NEITHER OF WHICH WAS FOUND CARRY THE SAME POLICY VACUOUSLY**, so a collapsed walk ' +
        'passes this suite perfectly',
    );
    assertTrue(
      'and it reached more than one file',
      files.size >= 8,
      `enums were found in only ${String(files.size)} files; there were 13 on 2026-09-09`,
    );
    assertTrue(
      `${ISOLATION} at least one value set is DUPLICATED, or this check has no subject`,
      duplicated.length > 0,
      'no value set appears twice, so every group is a singleton and the comparison below is ' +
        'vacuous. If the `$ref` collapse has genuinely unified every shared enum, this case has ' +
        'done its job and should be RETIRED deliberately — not left passing over nothing',
    );

    // ---- THE VERDICT. Named, not counted: a failure says WHICH sets and WHERE.
    const inconsistent: string[] = [];
    let exempted = 0;
    let diverging = 0;
    for (const group of duplicated) {
      const policies = [...new Set(group.map((occurrence) => String(occurrence.policy)))].sort();
      if (policies.length === 1) continue;
      diverging += 1;

      // A DECLARED, MUTUAL, REASONED DIVERGENCE IS THE ONLY WAY PAST THIS. A malformed exemption
      // is reported as a FAULT rather than silently failing to exempt — otherwise the pair goes
      // red with no explanation of why the marker did not take.
      const { exempt, faults } = divergenceExemption(group);
      if (exempt) {
        exempted += 1;
        continue;
      }
      inconsistent.push(
        `[${policies.join(' vs ')}] ${group.map((o) => `${o.file}${o.pointer}`).join('  +  ')}` +
          (faults.length > 0 ? `\n             ${faults.join('\n             ')}` : ''),
      );
    }

    console.log(
      `        enum divergence: ${String(duplicated.length)} duplicated sets · ` +
        `${String(duplicated.length - diverging)} agree · ${String(exempted)} exempted · ` +
        `${String(inconsistent.length)} unexplained`,
    );

    // *** IF EVERY DUPLICATED SET WERE EXEMPTED, THIS CASE WOULD PASS VACUOUSLY. ***
    // Every pair exempted reads exactly like every pair agreeing — the failure mode this check
    // exists to prevent, arriving through its own escape hatch.
    assertTrue(
      `${ISOLATION} not every duplicated set is exempted — the comparison still has a subject`,
      exempted < duplicated.length,
      `all ${String(duplicated.length)} duplicated value sets carry a divergence exemption, so this ` +
        'case compares nothing and passes. An exemption is for the rare legitimate pair, never for ' +
        'the common case',
    );

    assertEqual(
      `${ISOLATION} no two enums with the same values diverge in policy without a declared, mutual exemption`,
      inconsistent.join('\n           '),
      '',
    );
  });

  suite.test('*** A DIVERGENCE EXEMPTION MUST BE MUTUAL — a one-sided one is a suppression ***', () => {
    // ===================================================================================
    // THE ESCAPE HATCH IS THE MOST DANGEROUS PART OF THIS CHECK, so it has more controls than
    // the check itself. **If one side could exempt itself, silencing a genuine drift would cost
    // one edit in a file somebody already had open.**
    // ===================================================================================
    const at = (
      pointer: string,
      policy: string,
      divergence?: { counterpart?: unknown; reason?: unknown },
    ): EnumOccurrence => ({ file: 'x.schema.json', pointer, values: ['a', 'b'], policy, divergence });

    const MUTUAL_A = { counterpart: '#/$defs/b', reason: 'Response versus request direction.' };
    const MUTUAL_B = { counterpart: '#/$defs/a', reason: 'Request versus response direction.' };

    // ---- THE MIRROR FIRST. A check that rejects the legitimate case is the same defect from the
    // other side, and it is the reason this whole mechanism exists.
    const good = divergenceExemption([at('#/$defs/a', 'extensible', MUTUAL_A), at('#/$defs/b', 'closed', MUTUAL_B)]);
    assertTrue(
      `${ISOLATION} MIRROR: a mutual, reasoned, resolving exemption IS honoured`,
      good.exempt && good.faults.length === 0,
      `the legitimate pair was refused: ${JSON.stringify(good.faults)}`,
    );

    // ---- 1. ONE-SIDED. The whole safety property.
    const oneSided = divergenceExemption([at('#/$defs/a', 'extensible', MUTUAL_A), at('#/$defs/b', 'closed')]);
    assertTrue(
      `${ISOLATION} a ONE-SIDED declaration does not exempt, and says so`,
      !oneSided.exempt && oneSided.faults.some((fault) => fault.includes('ONE-SIDED')),
      `faults=${JSON.stringify(oneSided.faults)}`,
    );

    // ---- 2. A COUNTERPART THAT DOES NOT RESOLVE.
    const dangling = divergenceExemption([
      at('#/$defs/a', 'extensible', { counterpart: '#/$defs/nowhere', reason: 'r' }),
      at('#/$defs/b', 'closed', MUTUAL_B),
    ]);
    assertTrue(
      `${ISOLATION} a counterpart naming a definition that is not in the group does not exempt`,
      !dangling.exempt && dangling.faults.some((fault) => fault.includes('nowhere')),
      `faults=${JSON.stringify(dangling.faults)}`,
    );

    // ---- 3. NOT MUTUAL: it points at something that points elsewhere.
    const asymmetric = divergenceExemption([
      at('#/$defs/a', 'extensible', { counterpart: '#/$defs/b', reason: 'r' }),
      at('#/$defs/b', 'closed', { counterpart: '#/$defs/c', reason: 'r' }),
    ]);
    assertTrue(
      `${ISOLATION} a counterpart that does not point BACK does not exempt`,
      !asymmetric.exempt && asymmetric.faults.some((fault) => fault.includes('point back')),
      `faults=${JSON.stringify(asymmetric.faults)}`,
    );

    // ---- 4. AN EMPTY REASON — an allowlist row wearing a schema's clothes.
    const unreasoned = divergenceExemption([
      at('#/$defs/a', 'extensible', { counterpart: '#/$defs/b', reason: '   ' }),
      at('#/$defs/b', 'closed', MUTUAL_B),
    ]);
    assertTrue(
      `${ISOLATION} an empty \`reason\` does not exempt`,
      !unreasoned.exempt && unreasoned.faults.some((fault) => fault.includes('reason')),
      `faults=${JSON.stringify(unreasoned.faults)}`,
    );

    // ---- 5. NOT AMENDMENT 1'S SHAPE. Two `closed` defs with a mutual, reasoned marker between
    // them is **two enums disagreeing about nothing** — and there is nothing to exempt, because
    // they do not disagree at all. The interesting form is two `extensible` ones, which DO differ
    // from the licensed shape and which the marker must not silence.
    const bothExtensible = divergenceExemption([
      at('#/$defs/a', 'extensible', MUTUAL_A),
      at('#/$defs/b', 'extensible', MUTUAL_B),
    ]);
    assertTrue(
      `${ISOLATION} a mutual marker between two \`extensible\` defs does NOT exempt`,
      !bothExtensible.exempt && bothExtensible.faults.some((f) => f.includes("AMENDMENT 1'S SHAPE")),
      'the exemption is scoped to one `extensible` beside one `closed`; any other combination is ' +
        `not what 0041 amendment 1 permits: ${JSON.stringify(bothExtensible.faults)}`,
    );

    // ---- 6. A NON-LOCAL POINTER. Only `#/$defs/<name>` is resolvable here, and a form this
    // cannot follow must be refused rather than assumed to resolve somewhere.
    const foreign = divergenceExemption([
      at('#/$defs/a', 'extensible', { counterpart: 'urn:dudo:schema:other:1#/$defs/b', reason: 'r' }),
      at('#/$defs/b', 'closed', MUTUAL_B),
    ]);
    assertTrue(
      `${ISOLATION} a counterpart this check cannot follow does not exempt`,
      !foreign.exempt,
      `faults=${JSON.stringify(foreign.faults)}`,
    );

    // ---- AND THE REAL PAIR, read from disk, MUST BE EXEMPT. The constructed mirror above proves
    // the logic; this proves it accepts the actual artifact `0041` amendment 1 sanctioned.
    const live = enumOccurrences(CONTRACTS).filter(
      (entry) => entry.divergence !== undefined,
    );
    assertTrue(
      `${ISOLATION} the live divergence pair is present and mutually declared`,
      live.length >= 2 && divergenceExemption(live).exempt,
      `the corpus's declared-divergence enums do not form a valid exemption: ` +
        `${JSON.stringify(live.map((e) => `${e.file}${e.pointer}`))} ` +
        `faults=${JSON.stringify(divergenceExemption(live).faults)}`,
    );
  });

  suite.test('*** SAME `$defs` NAME, SAME VALUES — the drift the value-keyed check cannot see ***', () => {
    // ===================================================================================
    // *** THESE TWO CHECKS ARE NOT DUPLICATES AND NEITHER SUBSUMES THE OTHER. DO NOT DELETE
    // *** EITHER AS "THE SAME CHECK". ***
    // ===================================================================================
    //
    // `web-agent` found the blind spot by constructing it against the real files:
    //
    //   today                  3 platformRole copies · 1 value set · 3 examined · GREEN
    //   one copy gains a role  3 copies · 2 value sets · 2 examined · 1 NOT EXAMINED · GREEN
    //
    // **The value-keyed case groups by identical values and looks only at groups of size > 1 — so
    // the copy that DRIFTED leaves the group, and the check reports consistency over the two that
    // still agree.** Divergence is precisely the condition that removes a copy from that
    // comparison. It guards the POLICIES, which is what it was built for; the VALUES were
    // unguarded, and for `platformRole` the values are the thing that matters.
    //
    // `workflow.md` §11a's test for a duplicate check is *"would each go red on an input the other
    // passes"*, and both can name one:
    //
    //   value-keyed catches  policy drift among copies whose VALUES still agree
    //                blind to  a copy whose values drifted — it becomes a singleton
    //   name-keyed  catches  value drift among same-named definitions
    //                blind to  two DIFFERENTLY-named defs that happen to share values
    //
    // **This repository has nearly deleted a pair like this before** — the two
    // permission-reachability checks that traverse in opposite directions.
    //
    // *** SAME EVENTUAL FATE AS ITS SIBLING. *** If the `$ref` collapse unifies these definitions,
    // a shared name cannot diverge because there is only one, and this case should be **retired
    // deliberately** rather than left passing over nothing. The floor below is what makes that
    // visible instead of silent.
    const named = namedEnumDefs(CONTRACTS);
    const groups = new Map<string, NamedEnumDef[]>();
    for (const definition of named) {
      const group = groups.get(definition.name) ?? [];
      group.push(definition);
      groups.set(definition.name, group);
    }
    const shared = [...groups.entries()].filter(([, group]) => group.length > 1);
    const examined = shared.reduce((sum, [, group]) => sum + group.length, 0);

    console.log(
      `        enum names: ${String(named.length)} named \`$defs\` enums · ${String(groups.size)} distinct names · ` +
        `${String(shared.length)} in more than one file · ${String(examined)} occurrences examined`,
    );

    // ---- THE FLOOR. A name-keyed check over a corpus where no name repeats passes vacuously,
    // exactly as the value-keyed one does over a corpus with no duplicated set.
    assertTrue(
      `${ISOLATION} the walk found the named enum definitions`,
      named.length >= 15,
      `only ${String(named.length)} named \`$defs\` enums were found; there were 26 on 2026-09-09`,
    );
    assertTrue(
      `${ISOLATION} at least one NAME appears in more than one file, or this case has no subject`,
      shared.length > 0,
      'no `$defs` enum name is shared across files, so every group is a singleton and the ' +
        'comparison below examines nothing. If the `$ref` collapse has genuinely unified them, ' +
        'RETIRE this case deliberately rather than leaving it green over an empty set',
    );

    const divergent: string[] = [];
    for (const [name, group] of shared) {
      const sets = [...new Set(group.map((definition) => JSON.stringify(definition.values)))];
      if (sets.length === 1) continue;
      divergent.push(
        `${name}: ${group.map((d) => `${d.file} = ${JSON.stringify(d.values)}`).join('  vs  ')}`,
      );
    }
    assertEqual(
      `${ISOLATION} definitions sharing a name have identical value sets`,
      divergent.join('\n           '),
      '',
    );
  });

  suite.test('NAME-KEYED CONSTRUCTED INPUTS: value drift, and the mirrors', () => {
    const drift = (definitions: readonly NamedEnumDef[]): string[] => {
      const groups = new Map<string, NamedEnumDef[]>();
      for (const definition of definitions) {
        groups.set(definition.name, [...(groups.get(definition.name) ?? []), definition]);
      }
      const bad: string[] = [];
      for (const [name, group] of groups) {
        if (group.length < 2) continue;
        if (new Set(group.map((d) => JSON.stringify(d.values))).size > 1) bad.push(name);
      }
      return bad;
    };
    const def = (file: string, name: string, values: string[]): NamedEnumDef => ({
      file,
      name,
      values: [...values].sort(),
    });

    // ---- THE CASE `web-agent` CONSTRUCTED: one copy gains a value.
    assertEqual(
      `${ISOLATION} one copy gaining a value is reported`,
      drift([
        def('a.json', 'platformRole', ['platform-admin', 'marketplace-moderator']),
        def('b.json', 'platformRole', ['platform-admin', 'marketplace-moderator', 'auditor']),
      ]).join(','),
      'platformRole',
    );

    // ---- AND THE INPUT THAT PROVES THE TWO CHECKS ARE DIFFERENT: the drifted copy is a
    // SINGLETON by value, so the value-keyed grouping drops it and reports nothing.
    const valueKeyed = byValueSet([
      { file: 'a.json', pointer: '#/$defs/platformRole', values: ['a', 'b'], policy: 'extensible', divergence: undefined },
      { file: 'b.json', pointer: '#/$defs/platformRole', values: ['a', 'b', 'c'], policy: 'closed', divergence: undefined },
    ]);
    assertEqual(
      `${ISOLATION} the SAME input produces no duplicated value group — which is the blind spot`,
      String([...valueKeyed.values()].filter((group) => group.length > 1).length),
      '0',
    );

    // ---- THE MIRRORS.
    assertEqual(
      'same name, same values is not reported',
      drift([def('a.json', 'x', ['p', 'q']), def('b.json', 'x', ['p', 'q'])]).join(','),
      '',
    );
    assertEqual(
      'DIFFERENT names sharing values are not reported — that is the other check\'s subject',
      drift([def('a.json', 'x', ['p', 'q']), def('b.json', 'y', ['p', 'q'])]).join(','),
      '',
    );
    assertEqual(
      `${ISOLATION} value ORDER does not make two identical sets look divergent`,
      drift([def('a.json', 'x', ['q', 'p']), def('b.json', 'x', ['p', 'q'])]).join(','),
      '',
    );
  });

  suite.test('THE CONSTRUCTED FAILING INPUTS — constructed, because the corpus is being repaired', () => {
    // ===================================================================================
    // *** INVENTED. The two live disagreements this check was commissioned for were fixed
    // *** while it was being written, and a third appeared and was fixed after it. A check
    // *** verified only by a corpus somebody is actively cleaning is verified by nothing.
    // ===================================================================================
    const group = (occurrences: readonly EnumOccurrence[]): string[] => {
      const bad: string[] = [];
      for (const entries of byValueSet(occurrences).values()) {
        if (entries.length < 2) continue;
        const policies = new Set(entries.map((entry) => String(entry.policy)));
        if (policies.size > 1) bad.push([...policies].sort().join(' vs '));
      }
      return bad;
    };
    const at = (file: string, values: string[], policy?: string): EnumOccurrence => ({
      file,
      divergence: undefined,
      pointer: '#/$defs/x',
      values: [...values].sort(),
      policy,
    });

    // ---- DIRECTION 1: two real policies disagreeing.
    assertEqual(
      `${ISOLATION} two copies with DIFFERENT declared policies are reported`,
      group([at('a.json', ['x', 'y'], 'closed'), at('b.json', ['x', 'y'], 'extensible')]).join(','),
      'closed vs extensible',
    );

    // ---- DIRECTION 2: THE HALF-DECLARED SET, and it is the one that actually happened.
    // `platformRole` had one of three copies declared. Treating undeclared as "no opinion" would
    // pass this, and it is precisely the state a migration produces.
    assertEqual(
      `${ISOLATION} one declared and one NOT is reported — undeclared is a state, not a policy`,
      group([at('a.json', ['x', 'y'], 'extensible'), at('b.json', ['x', 'y'])]).join(','),
      'extensible vs undefined',
    );

    // ---- THE MIRRORS, so this is not a checker that flags every duplicated set.
    assertEqual(
      'two copies agreeing are NOT reported',
      group([at('a.json', ['x', 'y'], 'closed'), at('b.json', ['x', 'y'], 'closed')]).join(','),
      '',
    );
    assertEqual(
      'a duplicated set with NO copy declared is NOT reported — phase 1\'s normal condition',
      group([at('a.json', ['x', 'y']), at('b.json', ['x', 'y'])]).join(','),
      '',
    );
    assertEqual(
      'and DIFFERENT value sets with different policies are NOT reported',
      group([at('a.json', ['x', 'y'], 'closed'), at('b.json', ['x', 'z'], 'extensible')]).join(','),
      '',
    );
    // ---- ORDER MUST NOT MATTER. The same set written in two orders is the same set, and a
    // check keyed on declaration order would miss every real duplicate that was not copy-pasted.
    assertEqual(
      `${ISOLATION} value order does not make two identical sets look different`,
      group([at('a.json', ['y', 'x'], 'closed'), at('b.json', ['x', 'y'], 'extensible')]).join(','),
      'closed vs extensible',
    );
  });

  return suite;
}
