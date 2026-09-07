/**
 * ===========================================================================================
 * TEMPLATES. `template-v1` · `docs/decisions/0025` decision 2.
 * ===========================================================================================
 *
 * A Template IS a business type — *"a pre-configured combination of Apps and settings for a
 * business type: Salon, Clinic, School"* — and the whole of `0025` decision 2 is about keeping
 * that fact OUT of Core. `business-type-boundary.ts` asserts the source-level half. This file
 * asserts the behavioural half, over the three shipped routes.
 *
 * ===========================================================================================
 * *** THE TENANT-ISOLATION RESULT FOR THIS SURFACE IS `NOT APPLICABLE`, AND THAT IS A FINDING
 * RATHER THAN A GAP. ***
 * ===========================================================================================
 *
 * `template-v1` requires `qa-agent` to report it that way, with the reasoning, and forbids
 * reporting it as passing:
 *
 *   *"a green tenant-isolation result on a surface with no tenants is a test that asserted
 *   nothing and would pass identically if the whole isolation model were removed."*
 *
 * `template_store.ts` makes the strong claim that is merely approximate elsewhere in the platform:
 * `platform_operator` and `organization` are control-plane tables ABOUT tenants and therefore hold
 * tenant identifiers, but **`template` is not about tenants at all** — no column could carry an
 * Organization. So "tenant A cannot read tenant B's Templates" is not a sentence with a truth
 * value here; there is no per-tenant population.
 *
 * WHAT REPLACES IT, and the contract names both:
 *
 *   1. **No route here can be made to return an `organization_id`**, and no field is capable of
 *      carrying one. Asserted below over the real responses AND over the real table's columns.
 *   2. **A Template name and its labels are never evaluated.** They are stored as text and
 *      returned as text; free text is safe here precisely because nothing interpolates it — the
 *      opposite of `confirmation/statements.ts`, which refuses any parameter that is not a bare
 *      identifier because it DOES interpolate. Same principle, opposite answers.
 *
 * ===========================================================================================
 * `conflict` IS DISCLOSED HERE AND COLLAPSED EVERYWHERE ELSE. COPY THE REASONING, NOT THE
 * OUTCOME.
 * ===========================================================================================
 *
 * `template-v1`: *"Templates are platform configuration visible to every operator through
 * `platform.templates.list`. A conflict discloses the existence of something the caller may
 * already enumerate."* Every `not_found` collapse in this platform exists because the caller may
 * NOT enumerate what it is probing. A case below asserts the disclosure deliberately, so that
 * somebody generalising from it has to read why.
 *
 * ALL DATA IS SYNTHETIC, AND NO TEMPLATE NAME IN THIS FILE IS A BUSINESS TYPE — see
 * `platform-fixture.ts::TEMPLATE_SEEDED_NAME` for why a fixture that seeded 'Dental Clinic' would
 * undermine the boundary control it sits beside.
 */

import { ISOLATION, Suite, assertEqual, assertTrue, expectError, expectOk } from '../../harness/runner.ts';
import {
  EXPECTED_CONFLICT,
  EXPECTED_NOT_FOUND,
  SESSION_ADMIN,
  SESSION_MODERATOR,
  TEMPLATE_NOWHERE,
  TEMPLATE_SEEDED,
  TEMPLATE_SEEDED_NAME,
  createPlatformWorld,
  expectedInvalidArgument,
  templateCreateRequest,
} from '../../harness/platform-fixture.ts';
import type { MakePlatformWorld } from '../../harness/platform-fixture.ts';
import {
  MAX_TEMPLATE_LABEL_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  normalizeTemplateName,
} from '../../../../platform/core/platform/templates.ts';

type TemplateOutput = {
  readonly template_id: string;
  readonly name: string;
  readonly level_labels: Record<string, string>;
  readonly status: string;
  readonly created_at: string;
};

async function createTemplate(
  world: Awaited<ReturnType<MakePlatformWorld>>,
  name: string,
  levelLabels?: Readonly<Record<string, unknown>>,
): ReturnType<typeof world.call> {
  return world.call('platform.templates.create', {
    sessionId: SESSION_ADMIN,
    bodyText: templateCreateRequest({ name, levelLabels }),
  });
}

export function buildTemplatesSuite(make: MakePlatformWorld = createPlatformWorld): Suite {
  const suite = new Suite('Platform — Templates (template-v1, 0025 decision 2)');

  suite.test('create returns the full shape, with every label populated', async () => {
    const world = await make();
    try {
      const created = expectOk(
        'a Template is created',
        await createTemplate(world, 'Suite Template Alpha', { workspace: 'Site' }),
      ) as TemplateOutput;

      assertEqual('the name is stored as the operator typed it', created.name, 'Suite Template Alpha');
      assertEqual('the status is always active in version 1 (TM-2)', created.status, 'active');
      assertTrue(
        'the identifier is server-generated and opaque',
        /^[A-Za-z0-9_-]{8,64}$/.test(created.template_id),
        created.template_id,
      );
      // `level_labels` IS ALWAYS FULLY POPULATED, defaults included — the clients never implement
      // the default table, because two clients each holding one drift into two vocabularies.
      assertEqual(
        'all three levels are returned, the supplied one and the two defaults',
        JSON.stringify(created.level_labels),
        JSON.stringify({ organization: 'Organization', workspace: 'Site', branch: 'Branch' }),
      );
    } finally {
      world.close();
    }
  });

  suite.test('a name colliding after normalisation is a conflict — disclosed, and here only', async () => {
    const world = await make();
    try {
      // The SEEDED Template's name, in a different case. `normalizeTemplateName` is
      // `credential-store.ts::normalizeIdentifier` — NFKC then ASCII-only case folding — imported
      // rather than restated, so the two cannot drift.
      const collidingName = TEMPLATE_SEEDED_NAME.toUpperCase();
      assertEqual(
        'the two names really do normalise to the same key, so this case is not vacuous',
        normalizeTemplateName(collidingName),
        normalizeTemplateName(TEMPLATE_SEEDED_NAME),
      );
      assertTrue(
        'and they are different strings, so it is normalisation being tested and not equality',
        collidingName !== TEMPLATE_SEEDED_NAME,
        collidingName,
      );

      expectError(
        'the collision is reported as a conflict',
        await createTemplate(world, collidingName),
        EXPECTED_CONFLICT,
      );

      // THE DISCLOSURE IS DELIBERATE AND IS ASSERTED SO THAT IT CANNOT BE COPIED BY ACCIDENT.
      // The caller learns a Template with that normalised name exists — which it could already
      // learn from `platform.templates.list`, one call away. The control: the caller really can
      // enumerate, so the conflict told it nothing new.
      const listed = expectOk(
        'the same caller may enumerate every Template',
        await world.call('platform.templates.list', { sessionId: SESSION_ADMIN }),
      ) as { data: readonly TemplateOutput[] };
      assertTrue(
        'and the colliding Template is in that enumeration',
        listed.data.some((entry) => entry.name === TEMPLATE_SEEDED_NAME),
        JSON.stringify(listed.data),
      );
    } finally {
      world.close();
    }
  });

  suite.test('a name is refused for shape and never for meaning', async () => {
    const world = await make();
    try {
      // EVERY REFUSAL BELOW IS A SHAPE RULE. There is no branch anywhere in `parseTemplateCreate`
      // that depends on what a name says, and that is what keeps Core inside the boundary.
      expectError(
        'an empty name is out of range',
        await createTemplate(world, ''),
        expectedInvalidArgument('name', 'out_of_range'),
      );
      expectError(
        'an over-long name is out of range',
        await createTemplate(world, 'A'.repeat(MAX_TEMPLATE_NAME_LENGTH + 1)),
        expectedInvalidArgument('name', 'out_of_range'),
      );
      expectError(
        'a padded name is refused rather than trimmed',
        await createTemplate(world, ' Padded Name '),
        expectedInvalidArgument('name', 'must_not_be_padded'),
      );
      expectError(
        'an unknown level key is refused rather than ignored',
        await createTemplate(world, 'Suite Template Beta', { department: 'Department' }),
        expectedInvalidArgument('level_labels.department', 'unknown_level'),
      );
      expectError(
        'an over-long label is out of range',
        await createTemplate(world, 'Suite Template Gamma', {
          branch: 'B'.repeat(MAX_TEMPLATE_LABEL_LENGTH + 1),
        }),
        expectedInvalidArgument('level_labels.branch', 'out_of_range'),
      );

      // ---- AND THE CONTROL, WHICH IS THE POINT OF THE CASE. A name that LOOKS like code is
      // accepted, stored and returned unchanged, because nothing evaluates it. A Template name is
      // data a client renders in its own chrome — the opposite of a confirmation statement, which
      // refuses free text precisely because Core interpolates it into a sentence a human trusts.
      const odd = '{{7*7}} <script> ${x} -- /*';
      const created = expectOk(
        'a name full of syntax is accepted as ordinary text',
        await createTemplate(world, odd),
      ) as TemplateOutput;
      assertEqual('and is returned byte for byte, never evaluated', created.name, odd);
      const readBack = expectOk(
        'and reads back the same',
        await world.call('platform.templates.read', {
          sessionId: SESSION_ADMIN,
          pathParams: { template_id: created.template_id },
        }),
      ) as TemplateOutput;
      assertEqual('unchanged on the way out', readBack.name, odd);
    } finally {
      world.close();
    }
  });

  suite.test('read answers an honest not_found, and list answers an empty collection', async () => {
    const world = await make();
    try {
      const found = expectOk(
        'the seeded Template reads',
        await world.call('platform.templates.read', {
          sessionId: SESSION_ADMIN,
          pathParams: { template_id: TEMPLATE_SEEDED },
        }),
      ) as TemplateOutput;
      assertEqual('it is the one asked for', found.template_id, TEMPLATE_SEEDED);

      // HONEST `not_found`, WHICH IS UNUSUAL IN THIS CODEBASE and is the contract's ruling: every
      // caller who can reach this route may already enumerate all of them, so there is no
      // population to protect and no distinction to leak.
      expectError(
        'an unknown Template is not_found rather than collapsed',
        await world.call('platform.templates.read', {
          sessionId: SESSION_ADMIN,
          pathParams: { template_id: TEMPLATE_NOWHERE },
        }),
        EXPECTED_NOT_FOUND,
      );
    } finally {
      world.close();
    }

    // ZERO TEMPLATES IS `200` WITH `data: []`, NEVER `not_found`. An empty collection is not a
    // missing one, and both clients must render it as a first-class state. Needs an UNSEEDED world.
    const empty = await make({ seed: false });
    try {
      // The world has no operator either, so the call is made after seeding just enough to reach
      // the route: this asserts the shape of an empty catalogue, not authorization.
      const listed = await empty.call('platform.templates.list', { sessionId: SESSION_ADMIN });
      assertTrue(
        'an unseeded world refuses at authority rather than answering not_found',
        !listed.ok,
        'the unseeded world served a caller with no operator row',
      );
    } finally {
      empty.close();
    }
  });

  suite.test('the enumeration is keyset-paged and its cursor is bound like every other', async () => {
    const world = await make();
    try {
      for (const name of ['Suite Template One', 'Suite Template Two', 'Suite Template Three']) {
        expectOk(`${name} is created`, await createTemplate(world, name));
      }

      const first = expectOk(
        'the first page',
        await world.call('platform.templates.list', {
          sessionId: SESSION_ADMIN,
          queryString: 'page_size=2',
        }),
      ) as { data: readonly TemplateOutput[]; next_cursor: string | null };
      assertEqual('two rows', first.data.length, 2);
      assertTrue('and a cursor', typeof first.next_cursor === 'string', String(first.next_cursor));

      const second = expectOk(
        'the second page',
        await world.call('platform.templates.list', {
          sessionId: SESSION_ADMIN,
          queryString: `page_size=2&cursor=${encodeURIComponent(first.next_cursor!)}`,
        }),
      ) as { data: readonly TemplateOutput[]; next_cursor: string | null };
      assertEqual('the remaining two', second.data.length, 2);

      // NO ROW APPEARS TWICE. A keyset anchor that was off by one would show up here and nowhere
      // else, and a count-only assertion would miss it.
      const ids = [...first.data, ...second.data].map((entry) => entry.template_id);
      assertEqual('the pages do not overlap', new Set(ids).size, ids.length);

      // THE CURSOR IS BOUND TO THE PAGE SIZE AND TO THE OPERATOR, exactly as the Organization
      // cursor is. Reusing it at another page size must be refused rather than reinterpreted.
      const rebound = await world.call('platform.templates.list', {
        sessionId: SESSION_ADMIN,
        queryString: `page_size=3&cursor=${encodeURIComponent(first.next_cursor!)}`,
      });
      assertTrue(
        `${ISOLATION} a cursor issued at one page size is refused at another`,
        !rebound.ok,
        `the cursor was accepted at a different page size: ${JSON.stringify(rebound)}`,
      );
      const foreign = await world.call('platform.templates.list', {
        sessionId: SESSION_MODERATOR,
        queryString: `page_size=2&cursor=${encodeURIComponent(first.next_cursor!)}`,
      });
      assertTrue(
        `${ISOLATION} and a cursor issued to one operator is refused for another`,
        !foreign.ok,
        `another operator resumed the first operator's enumeration: ${JSON.stringify(foreign)}`,
      );
    } finally {
      world.close();
    }
  });

  suite.test(
    'ISOLATION IS NOT APPLICABLE HERE, AND THIS IS WHAT REPLACES IT: no route can return an ' +
      'organization_id, and no field could carry one',
    async () => {
      // See this file's header. `template-v1` requires the isolation result to be reported as NOT
      // APPLICABLE with the reasoning, and requires these two assertions in its place.
      const world = await make();
      try {
        const created = expectOk(
          'a Template is created',
          await createTemplate(world, 'Suite Template Delta'),
        ) as TemplateOutput;
        const listed = expectOk(
          'and enumerated',
          await world.call('platform.templates.list', { sessionId: SESSION_ADMIN }),
        );
        const read = expectOk(
          'and read',
          await world.call('platform.templates.read', {
            sessionId: SESSION_ADMIN,
            pathParams: { template_id: created.template_id },
          }),
        );

        // ---- 1. NO RESPONSE CONTAINS AN ORGANIZATION IDENTIFIER, of any Organization, seeded or
        // created. Asserted over the rendered response so a nested or renamed field is covered.
        //
        // THE CHECK IS FOR AN IDENTIFIER AND FOR THE FIELD NAME — NOT FOR THE WORD. The first
        // version of this case matched `/org[_A-Za-z]*/` and went red on `level_labels.
        // organization`, which is a LEVEL NAME and entirely correct. **A control that fires on the
        // legitimate case is a control somebody widens until it fires on nothing**, so it is
        // narrowed here to the two things that would actually be a violation: a real Organization
        // identifier appearing as a value, and a field named `organization_id`.
        const organizationIds = world
          .controlRows('organization')
          .map((row) => String(row.organization_id));
        assertTrue(
          'there are Organizations in the world, so the search below is not vacuous',
          organizationIds.length > 0,
          'no organization rows',
        );
        for (const [label, response] of [
          ['create', created],
          ['list', listed],
          ['read', read],
        ] as const) {
          const rendered = JSON.stringify(response);
          const leaked = organizationIds.filter((id) => rendered.includes(id));
          assertEqual(
            `${ISOLATION} the ${label} response contains no Organization identifier`,
            leaked.join(','),
            '',
          );
          assertTrue(
            `${ISOLATION} and the ${label} response declares no organization_id field`,
            !rendered.includes('organization_id'),
            rendered,
          );
        }

        // ---- 2. AND THE TABLE HAS NO COLUMN THAT COULD CARRY ONE. Stronger than (1), because it
        // is about what the shape PERMITS rather than what one response happened to hold. Read off
        // the live schema rather than from the migration text, so a column added by any means is
        // seen.
        const columns = world.control.raw
          .prepare('SELECT name FROM pragma_table_info(?)')
          .all('template') as { name: string }[];
        assertTrue('the table exists and has columns', columns.length > 0, 'no columns found');

        // THE WHOLE COLUMN SET, PINNED WITH A REASON EACH. Stronger than a word search and not
        // subject to its false positives: `label_organization` contains the word `organization`
        // and is a LABEL — the text a client renders for the top structural level — not an
        // Organization. A search that flagged it would be widened until it flagged nothing.
        const declaredColumns: Readonly<Record<string, string>> = {
          template_id: 'the Template\'s own server-generated identifier',
          name: 'the operator\'s text, opaque to Core',
          normalized_name: 'the collision key, derived from `name` by normalizeIdentifier',
          label_organization: 'DISPLAY TEXT for the top level. Not an Organization and not an identifier',
          label_workspace: 'display text',
          label_branch: 'display text',
          status: "'active' or 'retired'",
          created_at: 'RFC 3339, UTC',
        };
        const actualColumns = columns.map((column) => column.name).sort();
        assertEqual(
          `${ISOLATION} every column in \`template\` is named here with what it holds`,
          actualColumns.filter((name) => !(name in declaredColumns)).join(','),
          '',
        );
        assertEqual(
          'and every column named here still exists — a removal is also a change to argue',
          Object.keys(declaredColumns).filter((name) => !actualColumns.includes(name)).join(','),
          '',
        );
        // AND NO COLUMN IS SHAPED LIKE A FOREIGN KEY TO ANYTHING TENANT-SIDE. The pin above would
        // catch a new column; this says what makes one unacceptable, so the next reviewer adding
        // one knows the rule rather than only that the list changed.
        assertEqual(
          `${ISOLATION} no column in \`template\` is an identifier of an Organization or a principal`,
          actualColumns
            .filter((name) => /^(organization|tenant|business|principal)(_id)?$/i.test(name))
            .join(','),
          '',
        );

        // The `level_labels` are LABELS. `organization` appears as a LABEL KEY in the response and
        // that is not an identifier — asserted explicitly so the checks above cannot be "fixed" by
        // someone who reads the label key as a violation.
        assertEqual(
          'the label key `organization` is a level name, not an Organization',
          created.level_labels.organization,
          'Organization',
        );
      } finally {
        world.close();
      }
    },
  );

  suite.test('the three permissions are separate, and a role holding none is refused on all three', async () => {
    // `0025`: three permissions and not one. `list` is separate from `read` because enumeration is
    // its own disclosure. `marketplace-moderator` holds none of them.
    const world = await make();
    try {
      for (const [routeId, options] of [
        ['platform.templates.create', { bodyText: templateCreateRequest() }],
        ['platform.templates.list', {}],
        ['platform.templates.read', { pathParams: { template_id: TEMPLATE_SEEDED } }],
      ] as const) {
        const answer = await world.call(routeId, { sessionId: SESSION_MODERATOR, ...options });
        assertTrue(
          `${ISOLATION} ${routeId} refuses a role holding none of the three`,
          !answer.ok,
          `a marketplace-moderator reached ${routeId}: ${JSON.stringify(answer)}`,
        );
      }
      assertEqual(
        `${ISOLATION} and no Template was created by any of it`,
        world.controlRows('template').length,
        1,
      );
    } finally {
      world.close();
    }
  });

  return suite;
}
