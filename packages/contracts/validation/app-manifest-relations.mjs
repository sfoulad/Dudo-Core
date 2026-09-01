/**
 * VALIDATOR-AZ7 — App manifest relational validation (VAL-OWN clause 3).
 *
 * WHAT THIS IS
 * ------------
 * Foundation Gate tooling. It is NOT product runtime, it is not shipped in a Worker,
 * and nothing in `core/**`, `apps/**`, or `plugins/**` imports it. It exists so that
 * the gate can answer "does an `own`-scoped Action actually target an owned Entity?"
 * with a run rather than with a claim.
 *
 * WHY IT IS HAND-WRITTEN AND DEPENDENCY-FREE
 * ------------------------------------------
 * TS1 (`TESTING_STANDARD.md` §11) is UNDECIDED: no test framework is approved, and
 * `0003` approves no npm package. No dependency is authorised for this file — not a
 * schema library, not a test runner, not a bundler, not a type checker. It therefore
 * uses only the Node.js standard runtime and standard ECMAScript, adds no
 * `package.json`, no lockfile, no build configuration, and no framework. When TS1 is
 * resolved this module is *called* by the chosen framework; it does not change.
 *
 * WHAT IT ENFORCES
 * ----------------
 * `AUTHORIZATION_STANDARD.md` §4 VAL-OWN and §4.1 VALIDATOR-AZ7. The schema
 * (`packages/contracts/registries/app-manifest.schema.json`) decides clauses 1 and 2 and
 * every question of field shape; it cannot decide clause 3, because JSON Schema
 * draft 2020-12 has no keyword that compares `actions[].targetEntity` against the `name`
 * values of sibling items in `entities[]`. That JOIN is what this module owes.
 *
 * The failure mode being closed is CWE-863: an App declares `ownershipField` on one
 * Entity — satisfying the manifest-level check — and applies `scope: own` to an Action
 * whose `targetEntity` is a different, unowned Entity. `own` then presents as the
 * narrowest scope in the system while restricting nothing. An `ownershipField` on an
 * unrelated Entity never substitutes, and this module never falls back to the
 * manifest-level clause when the per-Action clause fails.
 *
 * OPERATING CONSTRAINTS
 * ---------------------
 * - Input is an ALREADY PARSED manifest object. This module does no parsing.
 * - No file, network, environment, clock, or random access of any kind. Output is a
 *   pure function of the input.
 * - Deterministic: identical input yields an identical error array — same order, same
 *   codes, same paths, same messages. Order is document order (entities, then actions),
 *   never hash or key-iteration order.
 * - FAILS CLOSED. Anything unreadable, ambiguous, or unverifiable is an error, never a
 *   pass. A manifest is never accepted with an unresolved ownership target and then
 *   evaluated as though `own` had been applied.
 *
 * This module reports; it does not install, mutate, throw on invalid manifests, or
 * decide anything at invocation time. VALIDATOR-AZ7 item 6 (no ownership relation
 * accepted from a caller at runtime) is a Core runtime obligation and is out of scope
 * here.
 */

/** Stable error codes. Referenced by gate reports and by tests; do not renumber. */
export const AZ7_ERROR_CODES = Object.freeze({
  MANIFEST_UNREADABLE: 'AZ7_MANIFEST_UNREADABLE',
  ENTITIES_UNREADABLE: 'AZ7_ENTITIES_UNREADABLE',
  ACTIONS_UNREADABLE: 'AZ7_ACTIONS_UNREADABLE',
  ENTITY_UNREADABLE: 'AZ7_ENTITY_UNREADABLE',
  ENTITY_NAME_UNREADABLE: 'AZ7_ENTITY_NAME_UNREADABLE',
  ENTITY_NAME_DUPLICATE: 'AZ7_ENTITY_NAME_DUPLICATE',
  ENTITY_OWNERSHIP_FIELD_UNREADABLE: 'AZ7_ENTITY_OWNERSHIP_FIELD_UNREADABLE',
  ACTION_UNREADABLE: 'AZ7_ACTION_UNREADABLE',
  ACTION_SCOPE_UNREADABLE: 'AZ7_ACTION_SCOPE_UNREADABLE',
  TARGET_ENTITY_MISSING: 'AZ7_TARGET_ENTITY_MISSING',
  TARGET_ENTITY_UNREADABLE: 'AZ7_TARGET_ENTITY_UNREADABLE',
  TARGET_ENTITY_UNKNOWN: 'AZ7_TARGET_ENTITY_UNKNOWN',
  TARGET_ENTITY_AMBIGUOUS: 'AZ7_TARGET_ENTITY_AMBIGUOUS',
  TARGET_ENTITY_NOT_OWNED: 'AZ7_TARGET_ENTITY_NOT_OWNED',
  TARGET_FIELDS_UNREADABLE: 'AZ7_TARGET_FIELDS_UNREADABLE',
  TARGET_OWNERSHIP_FIELD_UNDECLARED: 'AZ7_TARGET_OWNERSHIP_FIELD_UNDECLARED'
});

const OWN_SCOPE = 'own';

/** True only for a plain object — not null, not an array. */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** RFC 6901 JSON Pointer escaping, so a pathological key cannot forge a path. */
function pointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointer(...segments) {
  return segments.length === 0 ? '' : `/${segments.map(pointerSegment).join('/')}`;
}

/** Every error carries the same four fields, always, in the same order. */
function makeError(code, path, message, rule) {
  return Object.freeze({ code, path, message, rule });
}

/**
 * Quote an untrusted manifest value for a message without letting it alter the shape
 * of the output. JSON.stringify is deterministic for the primitives that reach here.
 */
function quote(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Index `entities[]` by name, in document order.
 *
 * Returns a Map of name -> array of indices. A Map is used rather than a plain object
 * so that an entity named `__proto__`, `constructor`, or `toString` cannot collide with
 * anything on Object.prototype.
 */
function indexEntities(entities, errors) {
  const byName = new Map();

  for (let index = 0; index < entities.length; index += 1) {
    const entity = entities[index];

    if (!isObject(entity)) {
      errors.push(
        makeError(
          AZ7_ERROR_CODES.ENTITY_UNREADABLE,
          pointer('entities', index),
          'Entity is not an object, so no Action can resolve against it. Rejected.',
          'VALIDATOR-AZ7 item 1'
        )
      );
      continue;
    }

    const name = hasOwn(entity, 'name') ? entity.name : undefined;

    if (!isNonEmptyString(name)) {
      errors.push(
        makeError(
          AZ7_ERROR_CODES.ENTITY_NAME_UNREADABLE,
          pointer('entities', index, 'name'),
          'Entity has no readable non-empty string name, so a targetEntity reference to it cannot be resolved. Rejected.',
          'VALIDATOR-AZ7 item 1'
        )
      );
      continue;
    }

    if (hasOwn(entity, 'ownershipField') && !isNonEmptyString(entity.ownershipField)) {
      errors.push(
        makeError(
          AZ7_ERROR_CODES.ENTITY_OWNERSHIP_FIELD_UNREADABLE,
          pointer('entities', index, 'ownershipField'),
          `Entity ${quote(name)} declares ownershipField but it is not a non-empty string, so no ownership relation can be read from it. Rejected.`,
          'VALIDATOR-AZ7 item 3'
        )
      );
    }

    const existing = byName.get(name);
    if (existing === undefined) {
      byName.set(name, [index]);
    } else {
      existing.push(index);
      errors.push(
        makeError(
          AZ7_ERROR_CODES.ENTITY_NAME_DUPLICATE,
          pointer('entities', index, 'name'),
          `Entity name ${quote(name)} is already declared at /entities/${existing[0]}. Entity names are unique within a manifest; a duplicate makes every reference to it ambiguous and it is rejected rather than resolved by document order.`,
          'VALIDATOR-AZ7 item 2'
        )
      );
    }
  }

  return byName;
}

/**
 * Check the ownership relation of the Entity an `own`-scoped Action resolved to.
 *
 * This is the whole point of the module: the check is against the RESOLVED entity and
 * nothing else. An ownershipField anywhere else in the manifest contributes nothing.
 */
function checkResolvedOwnership(entity, entityIndex, actionIndex, errors) {
  const ownershipField = hasOwn(entity, 'ownershipField') ? entity.ownershipField : undefined;

  if (!isNonEmptyString(ownershipField)) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.TARGET_ENTITY_NOT_OWNED,
        pointer('actions', actionIndex, 'targetEntity'),
        `Action declares scope "own" but its resolved target entity at /entities/${entityIndex} declares no ownershipField. An ownershipField on any OTHER entity in this manifest does not satisfy this rule and is not considered. Without an ownership relation on the targeted entity, "own" restricts nothing while presenting as the narrowest scope in the system. Rejected.`,
        'VALIDATOR-AZ7 items 3 and 4'
      )
    );
    return;
  }

  const fields = hasOwn(entity, 'fields') ? entity.fields : undefined;

  if (!Array.isArray(fields)) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.TARGET_FIELDS_UNREADABLE,
        pointer('entities', entityIndex, 'fields'),
        `Target entity of the Action at /actions/${actionIndex} has no readable fields array, so its ownershipField ${quote(ownershipField)} cannot be verified to name a declared field. Unverifiable, therefore rejected.`,
        'VALIDATOR-AZ7 item 3'
      )
    );
    return;
  }

  const declares = fields.some(
    (field) => isObject(field) && hasOwn(field, 'name') && field.name === ownershipField
  );

  if (!declares) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.TARGET_OWNERSHIP_FIELD_UNDECLARED,
        pointer('entities', entityIndex, 'ownershipField'),
        `ownershipField ${quote(ownershipField)} does not name a field declared in this entity's own fields[], so it is not a valid ownership relation for the "own"-scoped Action at /actions/${actionIndex}. Rejected.`,
        'VALIDATOR-AZ7 item 3'
      )
    );
  }
}

/**
 * @param {unknown} action
 * @param {number} index Position in `actions[]`, used for the JSON path.
 * @param {{ entities: unknown[], byName: Map<string, number[]> }} entityIndex
 * @param {Array} errors Accumulator, appended in document order.
 */
function checkAction(action, index, entityIndex, errors) {
  if (!isObject(action)) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.ACTION_UNREADABLE,
        pointer('actions', index),
        'Action is not an object, so its scope and target cannot be read. Unverifiable, therefore rejected.',
        'VALIDATOR-AZ7 item 1'
      )
    );
    return;
  }

  const scope = hasOwn(action, 'scope') ? action.scope : undefined;

  // Fail closed: if the scope cannot be read, we cannot know whether this is an
  // `own`-scoped Action, and an unreadable scope is never treated as "not own".
  if (typeof scope !== 'string') {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.ACTION_SCOPE_UNREADABLE,
        pointer('actions', index, 'scope'),
        'Action has no readable string scope, so whether it is "own"-scoped cannot be determined. Unverifiable, therefore rejected.',
        'VALIDATOR-AZ7 item 1'
      )
    );
    return;
  }

  const isOwnScoped = scope === OWN_SCOPE;
  const hasTarget = hasOwn(action, 'targetEntity');
  const target = hasTarget ? action.targetEntity : undefined;

  if (!hasTarget) {
    if (isOwnScoped) {
      errors.push(
        makeError(
          AZ7_ERROR_CODES.TARGET_ENTITY_MISSING,
          pointer('actions', index, 'targetEntity'),
          'Action declares scope "own" but names no targetEntity. "Records this principal owns" has no referent until the Action names the record type. Rejected.',
          'VAL-OWN clause 2'
        )
      );
    }
    // Outside "own", an absent targetEntity is legitimate: most Actions have no
    // ownership concept and must not be forced to invent one.
    return;
  }

  if (!isNonEmptyString(target)) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.TARGET_ENTITY_UNREADABLE,
        pointer('actions', index, 'targetEntity'),
        'targetEntity is present but is not a non-empty string, so it cannot be resolved against entities[]. Rejected.',
        'VALIDATOR-AZ7 item 1'
      )
    );
    return;
  }

  const matches = entityIndex.byName.get(target);

  // Resolution and ambiguity apply to EVERY Action carrying a targetEntity, `own` or
  // not (VALIDATOR-AZ7 item 5). Outside `own` the reference still has to mean something;
  // it simply carries no scoping semantics.
  if (matches === undefined || matches.length === 0) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.TARGET_ENTITY_UNKNOWN,
        pointer('actions', index, 'targetEntity'),
        `targetEntity ${quote(target)} names no entity declared in this manifest's entities[]. An unknown target is never resolved against another manifest, a platform entity, or a default. Rejected.`,
        'VALIDATOR-AZ7 item 1'
      )
    );
    return;
  }

  if (matches.length > 1) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.TARGET_ENTITY_AMBIGUOUS,
        pointer('actions', index, 'targetEntity'),
        `targetEntity ${quote(target)} matches ${matches.length} entities in this manifest (indices ${matches.join(', ')}). An ambiguous ownership target is rejected, never resolved by document order.`,
        'VALIDATOR-AZ7 item 2'
      )
    );
    return;
  }

  if (!isOwnScoped) {
    // Item 5: outside "own", a resolved targetEntity is documentation. No ownership
    // requirement is imposed and no targeting behaviour is inferred from it.
    return;
  }

  const resolvedIndex = matches[0];
  checkResolvedOwnership(entityIndex.entities[resolvedIndex], resolvedIndex, index, errors);
}

/**
 * Validate the relational (cross-array) rules of an App manifest.
 *
 * @param {unknown} manifest An ALREADY PARSED manifest object. Not a path, not JSON text.
 * @returns {{ valid: boolean, errors: ReadonlyArray<{ code: string, path: string, message: string, rule: string }> }}
 *   `valid` is true only when `errors` is empty. Errors are in document order:
 *   manifest-level, then entities by index, then actions by index.
 */
export function validateManifestRelations(manifest) {
  const errors = [];

  if (!isObject(manifest)) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.MANIFEST_UNREADABLE,
        '',
        'Manifest is not an object. Nothing can be resolved, so it is rejected.',
        'VAL-OWN'
      )
    );
    return finish(errors);
  }

  const entities = hasOwn(manifest, 'entities') ? manifest.entities : undefined;
  const actions = hasOwn(manifest, 'actions') ? manifest.actions : undefined;

  if (!Array.isArray(entities)) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.ENTITIES_UNREADABLE,
        pointer('entities'),
        'Manifest has no readable entities array, so no targetEntity can be resolved. Unverifiable, therefore rejected.',
        'VALIDATOR-AZ7 item 1'
      )
    );
  }

  if (!Array.isArray(actions)) {
    errors.push(
      makeError(
        AZ7_ERROR_CODES.ACTIONS_UNREADABLE,
        pointer('actions'),
        'Manifest has no readable actions array, so no ownership target can be checked. Unverifiable, therefore rejected.',
        'VALIDATOR-AZ7 item 1'
      )
    );
  }

  if (!Array.isArray(entities) || !Array.isArray(actions)) {
    return finish(errors);
  }

  const entityIndex = { entities, byName: indexEntities(entities, errors) };

  for (let i = 0; i < actions.length; i += 1) {
    checkAction(actions[i], i, entityIndex, errors);
  }

  return finish(errors);
}

function finish(errors) {
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export default validateManifestRelations;
