/**
 * Verifies the Organization-selection requests this client actually sends, and
 * the one inference the whole flow rests on.
 *
 *   npm run verify:organization
 *
 * WHY THIS EXISTS. The web client shipped with NO Organization-selection step
 * at all and every request answered 422 for every principal. It was not caught
 * because every check of the flow was performed BY HAND against a deployment —
 * the probes called the picker and the selection explicitly, and the deployed
 * client never did. So the point of this file is that the CLIENT'S OWN
 * behaviour is asserted, with no human performing the step on its behalf.
 *
 * WHAT IT ASSERTS:
 *   - the two paths and methods, which differ by one character;
 *   - that NEITHER request carries a query string — Core refuses any query
 *     string wholesale on these routes, and a session route inherits none of
 *     the Action path's validation;
 *   - that selection sends EXACTLY `{organization_id}` and nothing beside it;
 *   - that the cookie is attached and no credential is expected back;
 *   - that the picker decodes `{"data":[...]}`, that `[]` is a valid answer,
 *     and that `display_name: null` survives as null rather than a placeholder;
 *   - THE DISCRIMINATOR: that `probeSession` reads a 422 as
 *     "authenticated, Organization required" and NOT as unknown or anonymous;
 *   - that a 401 anywhere on these routes still signals signed-out.
 *
 * WHAT IT DOES NOT ASSERT: that Core accepts any of it. These are stubbed
 * responses. End-to-end evidence against the deployment is `qa-agent`'s, and
 * the picker path specifically needs the two-membership principal.
 */

import {
  createHttpOrganizationClient,
  createFixtureOrganizationClient,
  mayBeOrganizationRequired,
  ORGANIZATION_ID_FIELD,
  ORGANIZATION_PICKER_PATH,
  ORGANIZATION_SELECT_PATH,
} from '../src/api/organization.ts';
import { probeSession } from '../src/api/auth.ts';
import { onUnauthenticated } from '../src/api/session-signal.ts';
import { ApiError } from '../src/api/errors.ts';

let failures = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const okay = a === e;
  if (!okay) failures += 1;
  console.log(
    `${okay ? 'PASS' : 'FAIL'}  ${name}` +
      (okay ? '' : `\n        expected ${e}\n        actual   ${a}`),
  );
}

function stub(respond) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return respond(url, init);
    },
  };
}

const ORG_A = 'AAAAAAAAAAAAAAAAAAAAAA';
const ORG_B = 'BBBBBBBBBBBBBBBBBBBBBB';

function envelope(code, message, status) {
  return new Response(JSON.stringify({ error: { code, message, request_id: 'r'.repeat(22) } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

console.log('\n=== The two paths differ by one character, and both are under /auth/ ===\n');
check('picker path', ORGANIZATION_PICKER_PATH, '/auth/session/organizations');
check('select path', ORGANIZATION_SELECT_PATH, '/auth/session/organization');
check('the select field', ORGANIZATION_ID_FIELD, 'organization_id');
check('neither path is under /api/v1', ORGANIZATION_PICKER_PATH.startsWith('/api/'), false);

console.log('\n=== The picker request ===\n');

{
  const { calls, fetchImpl } = stub(
    () =>
      new Response(
        JSON.stringify({ data: [{ organization_id: ORG_A, display_name: null }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  const organizations = createHttpOrganizationClient({ fetchImpl, baseUrl: '' });
  const list = await organizations.listEnterable();

  check('exactly one request', calls.length, 1);
  check('method', calls[0].init.method, 'GET');
  check('path', calls[0].url, '/auth/session/organizations');
  // Core refuses ANY query string on this route with invalid_argument /
  // unexpected_query_parameter. There is nothing optional about this.
  check('NO query string', calls[0].url.includes('?'), false);
  check('the cookie is attached', calls[0].init.credentials, 'same-origin');
  check('cache is no-store', calls[0].init.cache, 'no-store');
  check('no body is sent', calls[0].init.body, undefined);
  check('no content-type is set on a GET', calls[0].init.headers['content-type'], undefined);

  check('one Organization is decoded', list.length, 1);
  check('the identifier survives', list[0].organization_id, ORG_A);
  // "NO placeholder name. display_name null renders the organization_id
  // verbatim, in both clients."
  check('display_name stays NULL, never a placeholder', list[0].display_name, null);
}

console.log('\n=== An empty picker is a valid answer, not a failure ===\n');

{
  const { fetchImpl } = stub(
    () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const organizations = createHttpOrganizationClient({ fetchImpl, baseUrl: '' });
  const list = await organizations.listEnterable();
  // 200 with data: [] — an empty collection is not a missing one, and this
  // route never answers 404, because a 404 would be a statement about the
  // principal rather than about a resource.
  check('an empty list resolves rather than throwing', list, []);
}

console.log('\n=== The selection request ===\n');

{
  const { calls, fetchImpl } = stub(
    () =>
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const organizations = createHttpOrganizationClient({ fetchImpl, baseUrl: '' });
  await organizations.select(ORG_B);

  check('exactly one request', calls.length, 1);
  check('method', calls[0].init.method, 'POST');
  check('path', calls[0].url, '/auth/session/organization');
  check('NO query string', calls[0].url.includes('?'), false);
  check('content type', calls[0].init.headers['content-type'], 'application/json');
  check('the cookie is attached', calls[0].init.credentials, 'same-origin');

  const body = JSON.parse(calls[0].init.body);
  // selectOrganizationInput is additionalProperties: false with exactly one
  // field. A "remember this choice" here would fail the whole request.
  check('body has EXACTLY one key', Object.keys(body), ['organization_id']);
  check('and it is the chosen identifier', body.organization_id, ORG_B);
}

console.log('\n=== Selection failures are distinguished correctly ===\n');

{
  const { fetchImpl } = stub(() =>
    envelope('not_found', 'The requested resource does not exist.', 404),
  );
  const organizations = createHttpOrganizationClient({ fetchImpl, baseUrl: '' });
  let code = null;
  try {
    await organizations.select(ORG_B);
  } catch (thrown) {
    code = thrown instanceof ApiError ? thrown.code : 'not-an-ApiError';
  }
  // Three cases collapsed deliberately: no membership row, a membership that is
  // not active, and an Organization that does not exist. The client must not
  // try to tell them apart, and must not retry.
  check('a 404 decodes as not_found', code, 'not_found');
}

{
  const { fetchImpl } = stub(
    () =>
      new Response(
        JSON.stringify({ error: { code: 'quota_exceeded', message: 'x', request_id: 'r'.repeat(22) } }),
        { status: 429, headers: { 'retry-after': '3600', 'content-type': 'application/json' } },
      ),
  );
  const organizations = createHttpOrganizationClient({ fetchImpl, baseUrl: '' });
  let error = null;
  try {
    await organizations.select(ORG_B);
  } catch (thrown) {
    error = thrown;
  }
  check('a 429 decodes as quota_exceeded', error.code, 'quota_exceeded');
  check('the Retry-After is surfaced', error.retry_after_seconds, 3600);
}

console.log('\n=== A 401 on a session route still means signed out ===\n');

{
  let signalled = 0;
  const unsubscribe = onUnauthenticated(() => {
    signalled += 1;
  });
  const { fetchImpl } = stub(() => envelope('unauthenticated', 'Authentication is required.', 401));
  const organizations = createHttpOrganizationClient({ fetchImpl, baseUrl: '' });
  try {
    await organizations.listEnterable();
  } catch {
    /* expected */
  }
  unsubscribe();
  check('the signed-out signal fired exactly once', signalled, 1);
}

console.log('\n=== THE DISCRIMINATOR: a 422 is authenticated-and-unselected ===\n');

/*
 * The inference the whole flow rests on, asserted rather than trusted.
 *
 * Core's `failedPrecondition()` takes no arguments and carries a CONSTANT
 * message, so "no Organization selected" and "that customer is archived" are
 * byte-identical. `probeSession` can tell only because of the Action it uses:
 * `core.ListAuthorizedBusinesses` declares no `failed_precondition` of its own
 * (business-read-v1), so a 422 from it cannot have come from the Action and
 * must have come from authentication, before the router.
 */
function transportThatThrows(code) {
  return {
    name: 'stub',
    invoke: async () => {
      throw new ApiError({ code, message: 'The resource is not in a state that permits this operation.' });
    },
  };
}

{
  const probe = await probeSession(transportThatThrows('failed_precondition'));
  // NOT `unknown`: reading it that way is what made a reload show an error
  // panel to somebody whose credential was perfectly good.
  check('state is authenticated', probe.state, 'authenticated');
  check('organizationRequired is true', probe.organizationRequired, true);
  // NOT `anonymous`: answering a 422 with a login screen builds a loop that
  // cannot terminate, because a fresh login has no Organization selected either.
  check('it is never reported as anonymous', probe.state === 'anonymous', false);
  check('no error is surfaced to the gate', probe.error, null);
}

{
  const probe = await probeSession(transportThatThrows('unauthenticated'));
  check('a 401 is still anonymous', probe.state, 'anonymous');
  check('and does not ask for an Organization', probe.organizationRequired, false);
}

{
  const probe = await probeSession(transportThatThrows('unavailable'));
  check('an outage is still unknown', probe.state, 'unknown');
  check('and does not ask for an Organization', probe.organizationRequired, false);
  check('the error is surfaced for a retry', probe.error.code, 'unavailable');
}

{
  const probe = await probeSession({ name: 'stub', invoke: async () => ({ data: [] }) });
  check('a success is authenticated', probe.state, 'authenticated');
  check('with nothing to select', probe.organizationRequired, false);
}

console.log('\n=== The 422 predicate claims only what it can prove ===\n');

// It says "MIGHT be the Organization state". It cannot say more, and a caller
// that treated it as a diagnosis would draw a picker for an archived customer.
check('a failed_precondition may be it', mayBeOrganizationRequired(new ApiError({ code: 'failed_precondition' })), true);
check('a conflict is not', mayBeOrganizationRequired(new ApiError({ code: 'conflict' })), false);
check('a not_found is not', mayBeOrganizationRequired(new ApiError({ code: 'not_found' })), false);

console.log('\n=== The fixture client, which is what makes this reviewable locally ===\n');

{
  const one = createFixtureOrganizationClient(1);
  const listOne = await one.listEnterable();
  check('one Organization takes the auto-select path', listOne.length, 1);
  check('identifiers are 22 characters, like the real ones', listOne[0].organization_id.length, 22);
  check('and carry no invented name', listOne[0].display_name, null);

  const two = createFixtureOrganizationClient(2);
  check('two Organizations draw a picker', (await two.listEnterable()).length, 2);

  const none = createFixtureOrganizationClient(0);
  check('zero is the no-membership state', (await none.listEnterable()).length, 0);

  let raced = null;
  try {
    await two.select('not-an-organization');
  } catch (thrown) {
    raced = thrown.code;
  }
  check('selecting something not offered is not_found', raced, 'not_found');
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
