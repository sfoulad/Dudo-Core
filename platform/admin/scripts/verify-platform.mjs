/**
 * Verifies the platform client against the shapes Core actually produces.
 *
 *   npm run verify:platform
 *
 * ===========================================================================
 * WHY THIS EXISTS: "CONFIRM YOU ARE READING THE REAL RESPONSE RATHER THAN A
 * SHAPE YOU EXPECT."
 * ===========================================================================
 *
 * The success body on this class is NOT the Action-class envelope. It was
 * checked in the implementation rather than assumed:
 *
 *   platform-routes.ts   ends its dispatch with `ok(outcome.value.body)`
 *   http/api.ts:364      passes that straight to `renderSuccess`
 *   http/response.ts:102 is `JSON.stringify(payload)`, no wrapping
 *
 * So `data` and `next_cursor` are TOP-LEVEL keys. The single most likely way to
 * get this wrong is to write `body.data.data` — or to cast the response and read
 * `undefined` — and the check below that matters most is the one asserting an
 * ENVELOPED body is REJECTED. A client that accepted both shapes would be a
 * client that could not tell which one it got.
 *
 * IT IMPORTS THE REAL MODULE and drives it through an injected `fetch`, so what
 * is exercised is the shipped `platform.ts`, not a description of it. No network
 * is touched and no server is needed.
 *
 * EVERY IDENTIFIER BELOW IS SYNTHETIC. `.claude/rules/security.md` §6.
 */

import {
  createPlatformClient,
  parseListOrganizations,
  parseListTemplates,
  parseOnboardOrganization,
  parseOrganizationDetail,
  parseResolveMember,
  parseTemplate,
  parseWhoami,
  isKnownMembershipRole,
  isKnownOnboardingWarning,
  isKnownStatus,
  ONBOARDING_WARNINGS,
  DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
  templateLabelRefusal,
  templateNameRefusal,
  ORGANIZATIONS_PATH,
  TEMPLATES_PATH,
  WHOAMI_PATH,
  PLATFORM_BASE_PATH,
  PLATFORM_DEFAULT_PAGE_SIZE,
  PLATFORM_MAX_PAGE_SIZE,
} from '../src/api/platform.ts';
import { probeOperatorSession } from '../src/api/platform-session.ts';
/*
 * THE REAL GENERATOR, imported rather than reimplemented. It lives in its own
 * module precisely so this import is possible — `onboarding-credential.ts`
 * pulls in the Web Worker and cannot be loaded under Node. For a value whose
 * only job is to be unguessable, testing a copy would verify nothing.
 */
import {
  generateAdminPassword,
  GENERATED_PASSWORD_LENGTH,
} from '../src/api/generate-password.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/*
 * The shared identifier check, imported so the non-ASCII sentinel below is
 * derived from the real function rather than from a copied sentence. `kdf.ts`
 * imports nothing, so a bare loader resolves it.
 */
import { identifierRefusal } from '../src/api/kdf.ts';

let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` +
      (ok
        ? ''
        : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`),
  );
}

function checkTrue(name, actual) {
  check(name, actual, true);
}

async function checkThrows(name, run, expectedCode) {
  try {
    await run();
    failures += 1;
    console.log(`FAIL  ${name}\n        expected a throw with code ${expectedCode}, got none`);
  } catch (thrown) {
    check(name, thrown?.code, expectedCode);
  }
}

/** A `fetch` that answers once, and records what it was asked. */
function stubFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { impl, calls };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/* =========================================================================
   1. PATHS AND CONSTANTS
   ========================================================================= */

console.log('\n=== Paths and constants, against platform-routes.ts ===\n');

check('base path', PLATFORM_BASE_PATH, '/api/v1/platform');
check('whoami path', WHOAMI_PATH, '/api/v1/platform/whoami');
check('organizations path', ORGANIZATIONS_PATH, '/api/v1/platform/organizations');
check('templates path', TEMPLATES_PATH, '/api/v1/platform/templates');
check('default page size', PLATFORM_DEFAULT_PAGE_SIZE, 25);
check('max page size', PLATFORM_MAX_PAGE_SIZE, 100);

/* =========================================================================
   2. THE SUCCESS BODY IS THE RESPONSE — NO ENVELOPE
   ========================================================================= */

console.log('\n=== whoami: the real shape, and the wrong ones ===\n');

/*
 * Exactly what `whoami()` in platform-route-handlers.ts returns.
 *
 * THE PRINCIPAL ID IS SYNTHETIC; THE SIX PERMISSION IDS ARE THE REAL ONES, read
 * off `platform-permissions.ts:110-115` and in the order
 * `PLATFORM_PERMISSION_ENVELOPE.declared` lists them. They are real because a
 * fixture carrying invented identifiers is a fixture someone later copies as
 * truth — I had `core.principal.reset-credential` here from memory and it is
 * `core.credential.reset`.
 *
 * NOTHING BELOW ASSERTS ON THESE VALUES. The client does not interpret a
 * permission id — it renders the list and never branches on it — so these
 * exercise the SHAPE only. That is deliberate: a client that recognised specific
 * permission ids would be a client holding permission logic, which ADR 0010 §7
 * forbids.
 *
 * It is `platform-admin`'s SIX, not the eight the role holds:
 * `reachablePlatformPermissions` intersects the role's grants with the envelope,
 * so `core.principal.grant-platform-scope` and `core.marketplace.moderate` are
 * deliberately not reported — no route can reach them.
 */
const WHOAMI_BODY = {
  principal_id: 'pr_synthetic_00000001',
  platform_role: 'platform-admin',
  permissions: [
    'core.organization.list',
    'core.organization.create',
    'core.template.read',
    'core.template.list',
    'core.template.create',
    'core.credential.reset',
  ],
};

const whoami = parseWhoami(WHOAMI_BODY);
check('principal_id is read from the top level', whoami.principal_id, 'pr_synthetic_00000001');
check('platform_role is read from the top level', whoami.platform_role, 'platform-admin');
check('permissions length', whoami.permissions.length, 6);

/*
 * THE CHECK THAT MATTERS MOST. If a proxy, a future refactor or a partial deploy
 * ever wrapped the body in the Action-class envelope, this client must REFUSE it
 * rather than read `undefined` fields and render blanks.
 */
try {
  parseWhoami({ data: WHOAMI_BODY });
  failures += 1;
  console.log('FAIL  an ENVELOPED whoami body is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  an ENVELOPED whoami body is refused, not silently misread');
}

try {
  parseWhoami({ principal_id: 'pr_x', platform_role: 'platform-admin' });
  failures += 1;
  console.log('FAIL  a missing "permissions" is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a missing "permissions" is refused');
}

try {
  parseWhoami({ ...WHOAMI_BODY, permissions: [1, 2] });
  failures += 1;
  console.log('FAIL  a non-string permission is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a non-string permission is refused');
}

console.log('\n=== organizations.list: the real shape ===\n');

// Exactly what `listOrganizations()` emits, including `display_name: null`.
const LIST_BODY = {
  data: [
    {
      organization_id: 'og_synthetic_0000000001',
      status: 'active',
      created_at: '2026-09-05T09:00:00Z',
      display_name: null,
    },
    {
      organization_id: 'og_synthetic_0000000002',
      status: 'suspended',
      created_at: '2026-09-04T08:30:00Z',
      display_name: null,
    },
  ],
  next_cursor: null,
};

const page = parseListOrganizations(LIST_BODY);
check('data is read from the TOP LEVEL, not body.data.data', page.data.length, 2);
check('organization_id', page.data[0].organization_id, 'og_synthetic_0000000001');
check('status is carried through as a string', page.data[0].status, 'active');
check('display_name is null and stays null', page.data[0].display_name, null);
check('next_cursor null', page.next_cursor, null);
check('a cursor is carried through', parseListOrganizations({ ...LIST_BODY, next_cursor: 'c_abc' }).next_cursor, 'c_abc');

try {
  parseListOrganizations({ data: { data: LIST_BODY.data }, next_cursor: null });
  failures += 1;
  console.log('FAIL  a DOUBLE-ENVELOPED list is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a DOUBLE-ENVELOPED list is refused, not silently misread');
}

try {
  parseListOrganizations({ data: [{ organization_id: 'og_x', status: 'active' }], next_cursor: null });
  failures += 1;
  console.log('FAIL  a row missing created_at is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a row missing created_at is refused');
}

/*
 * `display_name` MUST BE PRESENT. The schema requires the key and the handler
 * emits it always-and-null, precisely so that absent-versus-null is not a
 * distinction two clients resolve differently. A row without it is a contract
 * violation and is refused rather than defaulted.
 */
try {
  parseListOrganizations({
    data: [{ organization_id: 'og_x', status: 'active', created_at: '2026-09-05T09:00:00Z' }],
    next_cursor: null,
  });
  failures += 1;
  console.log('FAIL  a row with display_name ABSENT is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a row with display_name ABSENT is refused (absent is not null)');
}

console.log('\n=== status is not narrowed by a cast ===\n');
checkTrue('active is known', isKnownStatus('active'));
checkTrue('suspended is known', isKnownStatus('suspended'));
check('an unexpected status is NOT claimed as known', isKnownStatus('archived'), false);
check(
  'an unexpected status still parses and is carried through verbatim',
  parseListOrganizations({
    data: [{ ...LIST_BODY.data[0], status: 'archived' }],
    next_cursor: null,
  }).data[0].status,
  'archived',
);

/* =========================================================================
   3. THE REQUEST
   ========================================================================= */

console.log('\n=== The request Core receives ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(WHOAMI_BODY));
  await createPlatformClient({ fetchImpl: impl }).whoami();
  check('whoami calls the whoami path', calls[0].url, '/api/v1/platform/whoami');
  check('whoami is a GET', calls[0].init.method, 'GET');
  check('the session cookie is attached', calls[0].init.credentials, 'same-origin');
  check('no body is sent on a GET', calls[0].init.body, undefined);
  check('redirects are refused', calls[0].init.redirect, 'error');
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations({ pageSize: 25, cursor: null });
  check(
    'a NULL cursor is OMITTED, never sent empty',
    calls[0].url,
    '/api/v1/platform/organizations?page_size=25',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations({ pageSize: 25, cursor: '' });
  check(
    'an EMPTY cursor is OMITTED too (Core refuses ?cursor=)',
    calls[0].url,
    '/api/v1/platform/organizations?page_size=25',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations({
    pageSize: 25,
    cursor: 'c_abc+/=',
  });
  checkTrue(
    'a real cursor is sent, URL-encoded',
    calls[0].url.includes('cursor=c_abc%2B%2F%3D'),
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(LIST_BODY));
  await createPlatformClient({ fetchImpl: impl }).listOrganizations();
  check(
    'no options sends no query at all (Core applies its own default)',
    calls[0].url,
    '/api/v1/platform/organizations',
  );
}

/* =========================================================================
   4. FAILURES — the ordinary error envelope
   ========================================================================= */

console.log('\n=== Failure envelopes and status mapping ===\n');

const ENVELOPE = (code, message) =>
  jsonResponse({ error: { code, message, request_id: 'rq_synthetic_01' } }, statusFor(code));

/**
 * `kernel/errors.ts::HTTP_STATUS_BY_CODE`, copied exactly.
 *
 * NOTE `rate_limited` AND `quota_exceeded` SHARE 429. That is the whole reason
 * the client reads the code from the envelope body rather than inferring it from
 * the status — and it is why this table is transcribed rather than guessed.
 *
 * THIS HELPER WAS ITSELF THE BUG ONCE: it omitted `conflict` and
 * `quota_exceeded`, returned `undefined`, and `new Response(body, {status:
 * undefined})` is a **200**. So two failure tests were quietly asserting against
 * a success response. A missing entry must be loud, hence the throw.
 */
const HTTP_STATUS_BY_CODE = {
  invalid_argument: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  failed_precondition: 422,
  rate_limited: 429,
  quota_exceeded: 429,
  internal: 500,
  unavailable: 503,
  timeout: 504,
};

function statusFor(code) {
  const status = HTTP_STATUS_BY_CODE[code];
  if (status === undefined) {
    throw new Error(
      `No HTTP status recorded for "${code}". Add it from kernel/errors.ts rather than ` +
        'letting it default — an undefined status becomes a 200 and turns a failure test into a ' +
        'success test.',
    );
  }
  return status;
}

for (const [code, expected] of [
  ['unauthenticated', 'unauthenticated'],
  ['forbidden', 'forbidden'],
  ['invalid_argument', 'invalid_argument'],
  ['rate_limited', 'rate_limited'],
  ['unavailable', 'unavailable'],
  ['internal', 'internal'],
  ['not_found', 'not_found'],
]) {
  const { impl } = stubFetch(ENVELOPE(code, 'synthetic'));
  await checkThrows(
    `${String(statusFor(code))} maps to ${expected}`,
    () => createPlatformClient({ fetchImpl: impl }).whoami(),
    expected,
  );
}

{
  const { impl } = stubFetch(ENVELOPE('unauthenticated', 'synthetic'));
  try {
    await createPlatformClient({ fetchImpl: impl }).whoami();
  } catch (thrown) {
    check('the request_id is carried off the envelope', thrown.request_id, 'rq_synthetic_01');
  }
}

{
  const { impl } = stubFetch(
    jsonResponse({ error: { code: 'rate_limited', message: 'x', request_id: 'rq_2', retry_after_seconds: 30 } }, 429),
  );
  try {
    await createPlatformClient({ fetchImpl: impl }).whoami();
  } catch (thrown) {
    check('retry_after_seconds is read from the body', thrown.retry_after_seconds, 30);
  }
}

{
  // A body that is not JSON at all. The status is still the answer.
  const { impl } = stubFetch(new Response('<html>gateway</html>', { status: 503 }));
  await checkThrows(
    'a non-JSON error body still maps by status',
    () => createPlatformClient({ fetchImpl: impl }).whoami(),
    'unavailable',
  );
}

{
  // A 200 whose body is not JSON. This must NOT be reported as success.
  const { impl } = stubFetch(new Response('not json', { status: 200 }));
  await checkThrows(
    'a 200 with a non-JSON body is refused, not treated as empty',
    () => createPlatformClient({ fetchImpl: impl }).whoami(),
    'internal',
  );
}

/* =========================================================================
   5. THE PROBE — the four answers, and the one that must not be a login loop
   ========================================================================= */

console.log('\n=== probeOperatorSession: four answers ===\n');

{
  const { impl } = stubFetch(jsonResponse(WHOAMI_BODY));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('200 -> operator', probe.kind, 'operator');
  check('and it carries the context', probe.whoami?.platform_role, 'platform-admin');
}

{
  const { impl } = stubFetch(ENVELOPE('unauthenticated', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('401 -> anonymous', probe.kind, 'anonymous');
}

{
  const { impl } = stubFetch(ENVELOPE('forbidden', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  // THE ONE THAT MATTERS. `refused` and not `anonymous`: rendering a 403 as a
  // sign-in screen builds a loop that cannot terminate, because signing in again
  // produces another session that is refused in exactly the same way.
  check('403 -> refused, NOT anonymous', probe.kind, 'refused');
}

{
  const { impl } = stubFetch(ENVELOPE('unavailable', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('503 -> unknown, NOT anonymous', probe.kind, 'unknown');
}

{
  const { impl } = stubFetch(ENVELOPE('not_found', 'x'));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  // A 404 here means the host does not serve platform routes, or the class is
  // not composed. A deployment fact, not a session fact.
  check('404 -> unknown (wrong host / class not composed)', probe.kind, 'unknown');
}

{
  // A 200 with a shape Core does not promise. It must NOT become `operator`.
  const { impl } = stubFetch(jsonResponse({ data: WHOAMI_BODY }));
  const probe = await probeOperatorSession(createPlatformClient({ fetchImpl: impl }));
  check('200 with an unreadable shape -> unknown, never operator', probe.kind, 'unknown');
}

/* =========================================================================
   6. TEMPLATES — template-v1
   ========================================================================= */

console.log('\n=== Templates: the real shape ===\n');

// Exactly what `toTemplateOutput()` in templates.ts emits.
const TEMPLATE_BODY = {
  template_id: 'tp_synthetic_0000000001',
  name: 'School',
  level_labels: { organization: 'Group', workspace: 'Campus', branch: 'Classroom' },
  status: 'active',
  created_at: '2026-09-05T10:00:00Z',
};

const template = parseTemplate(TEMPLATE_BODY);
check('template_id', template.template_id, 'tp_synthetic_0000000001');
check('name is carried verbatim', template.name, 'School');
check('the workspace label', template.level_labels.workspace, 'Campus');
check('status', template.status, 'active');

try {
  parseTemplate({ data: TEMPLATE_BODY });
  failures += 1;
  console.log('FAIL  an ENVELOPED template is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  an ENVELOPED template is refused, not silently misread');
}

/*
 * THE CHECK THAT PROTECTS THE ONE-CONTRACT RULE. `templateOutput` requires all
 * three labels and Core fills any the operator omitted, precisely so the two
 * clients cannot drift into different ideas of what an unlabelled level is
 * called. If this client silently substituted its own default for a missing
 * label, that guarantee would be defeated on this side and the defect would be
 * invisible — so a missing label is REFUSED.
 */
try {
  parseTemplate({ ...TEMPLATE_BODY, level_labels: { organization: 'Group', workspace: 'Campus' } });
  failures += 1;
  console.log('FAIL  a MISSING level label is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a MISSING level label is refused, never defaulted on the client');
}

try {
  parseTemplate({ ...TEMPLATE_BODY, level_labels: 'Campus' });
  failures += 1;
  console.log('FAIL  a non-object level_labels is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a non-object level_labels is refused');
}

const templatePage = parseListTemplates({ data: [TEMPLATE_BODY], next_cursor: null });
check('list data is TOP-LEVEL, not body.data.data', templatePage.data.length, 1);
check('list next_cursor', templatePage.next_cursor, null);
check(
  'zero templates is a valid page, not an error',
  parseListTemplates({ data: [], next_cursor: null }).data.length,
  0,
);

console.log('\n=== Templates: the request Core receives ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' });
  check('create posts to /templates', calls[0].url, '/api/v1/platform/templates');
  check('create is a POST', calls[0].init.method, 'POST');
  check('create sends JSON', calls[0].init.headers['content-type'], 'application/json');
  check('the session cookie is attached', calls[0].init.credentials, 'same-origin');
  // Only the declared field. No template_id, no status — the operator chooses
  // neither, and Core refuses any undeclared field outright.
  check('a bare create sends ONLY name', calls[0].init.body, JSON.stringify({ name: 'School' }));
}

{
  /*
   * THE ONE MOST LIKELY TO BE GOT WRONG. Core refuses a zero-length label with
   * `out_of_range`, so a blank field must be OMITTED rather than sent as ''.
   * Omission is what selects the platform default.
   */
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).createTemplate({
    name: 'School',
    level_labels: { organization: '', workspace: 'Campus', branch: '' },
  });
  check(
    'blank labels are OMITTED, never sent as empty strings',
    calls[0].init.body,
    JSON.stringify({ name: 'School', level_labels: { workspace: 'Campus' } }),
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).createTemplate({
    name: 'School',
    level_labels: { organization: '', workspace: '', branch: '' },
  });
  check(
    'all-blank labels omit level_labels entirely',
    calls[0].init.body,
    JSON.stringify({ name: 'School' }),
  );
}

{
  /*
   * CORE RETURNS 200 AND THE CONTRACT DECLARES 201 (http/api.ts:371 hardcodes
   * 200 for every platform route; PlatformRoute has no successStatus field).
   * This client accepts any 2xx, so it works against Core as it stands AND
   * against Core once corrected — encoding neither side's bug.
   */
  const { impl } = stubFetch(jsonResponse(TEMPLATE_BODY, 200));
  const created = await createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' });
  check('a 200 from create is accepted (Core returns 200 today)', created.name, 'School');
}
{
  const { impl } = stubFetch(jsonResponse(TEMPLATE_BODY, 201));
  const created = await createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' });
  check('a 201 from create is accepted (the contract declares 201)', created.name, 'School');
}

{
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY));
  await createPlatformClient({ fetchImpl: impl }).readTemplate('tp_abc');
  check('read puts the id in the PATH', calls[0].url, '/api/v1/platform/templates/tp_abc');
  check('read sends no body', calls[0].init.body, undefined);
}

{
  // The route declares no query parameters, so any query string is refused by
  // Core. A caller-supplied value must not be able to add path segments either.
  const { impl, calls } = stubFetch(jsonResponse(TEMPLATE_BODY));
  await createPlatformClient({ fetchImpl: impl }).readTemplate('a/b?c=d');
  check(
    'a hostile identifier is percent-encoded, not injected',
    calls[0].url,
    '/api/v1/platform/templates/a%2Fb%3Fc%3Dd',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listTemplates({ pageSize: 25, cursor: null });
  check(
    'list omits a null cursor',
    calls[0].url,
    '/api/v1/platform/templates?page_size=25',
  );
}

console.log('\n=== Templates: failures ===\n');

{
  const { impl } = stubFetch(ENVELOPE('conflict', 'x'));
  await checkThrows(
    '409 maps to conflict (a duplicate name)',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'conflict',
  );
}
{
  const { impl } = stubFetch(ENVELOPE('quota_exceeded', 'x'));
  await checkThrows(
    '429-class quota_exceeded is surfaced, not collapsed',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'quota_exceeded',
  );
}
{
  const { impl } = stubFetch(ENVELOPE('invalid_argument', 'x'));
  await checkThrows(
    '400 maps to invalid_argument',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: ' padded ' }),
    'invalid_argument',
  );
}
/*
 * THE 429 DISAMBIGUATION, BOTH DIRECTIONS. `rate_limited` and `quota_exceeded`
 * share status 429 in `kernel/errors.ts`, so only the envelope's `code` tells
 * them apart. Mislabelling a quota refusal as a rate limit tells an operator to
 * wait a moment when waiting will not help.
 */
{
  const { impl } = stubFetch(ENVELOPE('rate_limited', 'x'));
  await checkThrows(
    'a 429 carrying rate_limited stays rate_limited',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'rate_limited',
  );
}
{
  const { impl } = stubFetch(ENVELOPE('quota_exceeded', 'x'));
  await checkThrows(
    'the SAME 429 carrying quota_exceeded is NOT relabelled rate_limited',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'quota_exceeded',
  );
}
{
  // No readable envelope. The status is all there is, and `rate_limited` is the
  // conservative reading of a bare 429.
  const { impl } = stubFetch(new Response('<html>429</html>', { status: 429 }));
  await checkThrows(
    'a 429 with no readable envelope falls back to rate_limited',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'rate_limited',
  );
}

{
  // A 2xx whose body is not a Template. It must NOT be reported as created.
  const { impl } = stubFetch(jsonResponse({ ok: true }, 201));
  await checkThrows(
    'a 201 with an unreadable body is refused, never reported as created',
    () => createPlatformClient({ fetchImpl: impl }).createTemplate({ name: 'School' }),
    'internal',
  );
}

console.log('\n=== Templates: local form rules mirror Core ===\n');

check('an empty name is refused', templateNameRefusal('') !== null, true);
check('a padded name is refused, not trimmed', templateNameRefusal(' School ') !== null, true);
check('a trailing-space name is refused', templateNameRefusal('School ') !== null, true);
check('a plain name is accepted', templateNameRefusal('School'), null);
check('an 80-character name is accepted', templateNameRefusal('S'.repeat(80)), null);
check('an 81-character name is refused', templateNameRefusal('S'.repeat(81)) !== null, true);
// A blank label is valid input: it means "leave the default", and the client
// omits it rather than sending it.
check('a blank label is accepted locally (it means default)', templateLabelRefusal(''), null);
check('a padded label is refused', templateLabelRefusal(' Campus ') !== null, true);
check('a 40-character label is accepted', templateLabelRefusal('C'.repeat(40)), null);
check('a 41-character label is refused', templateLabelRefusal('C'.repeat(41)) !== null, true);

/* =========================================================================
   7. ONBOARDING — organization-onboarding-v1
   ========================================================================= */

console.log('\n=== Onboarding: the real shape ===\n');

const ONBOARD_BODY = {
  organization_id: 'og_synthetic_0000000009',
  admin_principal_id: 'pr_synthetic_0000000009',
  workspace_id: 'ws_synthetic_0000000009',
  warnings: [],
};

const onboarded = parseOnboardOrganization(ONBOARD_BODY);
check('organization_id', onboarded.organization_id, 'og_synthetic_0000000009');
check('admin_principal_id', onboarded.admin_principal_id, 'pr_synthetic_0000000009');
check('workspace_id', onboarded.workspace_id, 'ws_synthetic_0000000009');
check('warnings is empty on a clean success', onboarded.warnings.length, 0);

/*
 * THE PARTIAL SUCCESS. `workspace_id: null` with `first_workspace_not_created`
 * is a 201: the Organization, the admin and the credential all exist and the
 * tenant-side write did not. It must parse cleanly — a client that refused it
 * would discard the only copy of a real customer's credential.
 */
const partial = parseOnboardOrganization({
  ...ONBOARD_BODY,
  workspace_id: null,
  warnings: ['first_workspace_not_created'],
});
check('a null workspace_id parses (it is a success)', partial.workspace_id, null);
check('the warning is carried through', partial.warnings[0], 'first_workspace_not_created');
check('both warnings parse', parseOnboardOrganization({ ...ONBOARD_BODY, warnings: ONBOARDING_WARNINGS }).warnings.length, 2);

checkTrue('first_workspace_not_created is a known warning', isKnownOnboardingWarning('first_workspace_not_created'));
checkTrue('tenant_audit_record_not_written is a known warning', isKnownOnboardingWarning('tenant_audit_record_not_written'));
check('an invented warning is NOT claimed as known', isKnownOnboardingWarning('everything_is_fine'), false);
check(
  'an unrecognised warning still PARSES and is carried through verbatim',
  parseOnboardOrganization({ ...ONBOARD_BODY, warnings: ['something_newer'] }).warnings[0],
  'something_newer',
);

try {
  parseOnboardOrganization({ data: ONBOARD_BODY });
  failures += 1;
  console.log('FAIL  an ENVELOPED onboarding body is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  an ENVELOPED onboarding body is refused, not silently misread');
}
try {
  parseOnboardOrganization({ ...ONBOARD_BODY, warnings: undefined });
  failures += 1;
  console.log('FAIL  a missing warnings array is refused\n        expected a throw, got none');
} catch {
  console.log('PASS  a missing warnings array is refused (absent is not empty)');
}

console.log('\n=== Onboarding: the request Core receives ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(ONBOARD_BODY, 201));
  await createPlatformClient({ fetchImpl: impl }).onboardOrganization({
    admin_identifier: 'admin@example.com',
    template_id: 'tp_synthetic_0000000001',
    derived_value: 'A'.repeat(43),
  });
  check('onboarding posts to /organizations', calls[0].url, '/api/v1/platform/organizations');
  check('onboarding is a POST', calls[0].init.method, 'POST');
  check('the session cookie is attached', calls[0].init.credentials, 'same-origin');

  const sent = JSON.parse(calls[0].init.body);
  const sentKeys = Object.keys(sent).sort();
  /*
   * EXACTLY THE FOUR DECLARED FIELDS. The class refuses any undeclared field
   * BEFORE AUTHENTICATION, and the absence of `role`/`permissions`/
   * `organization_id`/`principal_id`/`password` is `0025` decision 4 bound 3
   * rather than tidiness: there is no field through which an existing
   * Organization could be named.
   */
  check(
    'exactly the four declared fields are sent',
    sentKeys.join(','),
    'admin_identifier,derived_value,first_workspace_name,template_id',
  );
  for (const forbidden of ['role', 'permissions', 'memberships', 'password', 'organization_id', 'principal_id', 'workspace_id']) {
    check(`"${forbidden}" is NOT sent, not even empty`, forbidden in sent, false);
  }
  check('the password itself is never sent', JSON.stringify(sent).includes('password'), false);
  check(
    'first_workspace_name is the fixed placeholder',
    sent.first_workspace_name,
    DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
  );
}

/*
 * THE PLACEHOLDER MUST SATISFY THE CONTRACT'S `workspaceName`: 1-120
 * characters, no leading or trailing whitespace. Core validates it and REFUSES
 * the whole request on a bad one — so a placeholder that failed validation would
 * make onboarding impossible while looking like a Core defect.
 */
console.log('\n=== Onboarding: the discarded placeholder is still valid input ===\n');
checkTrue('the placeholder is at least 1 character', DISCARDED_WORKSPACE_NAME_PLACEHOLDER.length >= 1);
checkTrue('the placeholder is at most 120 characters', DISCARDED_WORKSPACE_NAME_PLACEHOLDER.length <= 120);
check(
  'the placeholder has no leading or trailing whitespace',
  DISCARDED_WORKSPACE_NAME_PLACEHOLDER.trim(),
  DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
);

/* -------------------------------------------------------------------------
   The generated password — THE REAL FUNCTION, not a copy
   ------------------------------------------------------------------------- */

console.log('\n=== Onboarding: the generated password ===\n');

const samples = Array.from({ length: 200 }, () => generateAdminPassword());

check('every password is exactly 32 characters', new Set(samples.map((s) => s.length)).size, 1);
check('and that length is 32', samples[0].length, GENERATED_PASSWORD_LENGTH);
check('32 characters is the documented length', GENERATED_PASSWORD_LENGTH, 32);
checkTrue(
  'every password is base64url with no padding',
  samples.every((s) => /^[A-Za-z0-9_-]{32}$/.test(s)),
);

/*
 * 200 SAMPLES, ALL DISTINCT. This does not prove the source is a CSPRNG — no
 * test can — but it fails immediately on the mistakes that actually happen: a
 * constant, a counter, a value derived from the clock, or a generator seeded
 * once per page load.
 */
check('200 generated passwords are all distinct', new Set(samples).size, 200);

/*
 * AND A CRUDE ENTROPY FLOOR. 200 samples of 32 characters is 6,400 characters
 * from a 64-symbol alphabet; a generator emitting a narrow range — the classic
 * symptom of a broken byte-to-character step — would show far fewer distinct
 * symbols. Deliberately loose: this is a smoke alarm, not a statistical test.
 */
const alphabet = new Set(samples.join(''));
checkTrue(
  `the alphabet is wide (${String(alphabet.size)} distinct characters of a possible 64)`,
  alphabet.size >= 60,
);

console.log('\n=== Onboarding: failures ===\n');

for (const [code, note] of [
  ['conflict', 'the admin identifier already has a credential'],
  ['not_found', 'the template_id names no Template'],
  ['quota_exceeded', 'Core created NOTHING'],
  ['invalid_argument', 'a field failed validation'],
]) {
  const { impl } = stubFetch(ENVELOPE(code, 'synthetic'));
  await checkThrows(
    `${code} is surfaced — ${note}`,
    () =>
      createPlatformClient({ fetchImpl: impl }).onboardOrganization({
        admin_identifier: 'admin@example.com',
        template_id: 'tp_synthetic_0000000001',
        derived_value: 'A'.repeat(43),
      }),
    code,
  );
}

{
  // A 201 whose body is not an onboarding result. It must NOT be reported as a
  // success — a credential panel drawn from an unreadable response would show a
  // password for an account nobody can name.
  const { impl } = stubFetch(jsonResponse({ ok: true }, 201));
  await checkThrows(
    'a 201 with an unreadable body is refused, never shown as created',
    () =>
      createPlatformClient({ fetchImpl: impl }).onboardOrganization({
        admin_identifier: 'admin@example.com',
        template_id: 'tp_synthetic_0000000001',
        derived_value: 'A'.repeat(43),
      }),
    'internal',
  );
}

/* =========================================================================
   8. ORGANIZATION DETAIL — organization-detail-v1
   ========================================================================= */

console.log('\n=== Organization detail: the real shape ===\n');

const DETAIL_BODY = {
  organization_id: 'og_synthetic_0000000001',
  status: 'active',
  created_at: '2026-09-05T09:00:00Z',
  display_name: null,
  template: {
    template_id: 'tp_synthetic_0000000001',
    name: 'School',
    level_labels: { organization: 'Group', workspace: 'Campus', branch: 'Classroom' },
  },
  member_count: 3,
};

const detail = parseOrganizationDetail(DETAIL_BODY);
check('organization_id', detail.organization_id, 'og_synthetic_0000000001');
check('display_name stays null', detail.display_name, null);
check('member_count is a number', detail.member_count, 3);
check('the embedded template name', detail.template?.name, 'School');
check('the embedded workspace label', detail.template?.level_labels.workspace, 'Campus');

check(
  'a null template parses (no Template recorded)',
  parseOrganizationDetail({ ...DETAIL_BODY, template: null }).template,
  null,
);
check('member_count of 0 parses', parseOrganizationDetail({ ...DETAIL_BODY, member_count: 0 }).member_count, 0);

/*
 * `template` IS REQUIRED AND NULLABLE, NOT OPTIONAL. An absent key is a contract
 * violation; reading it as null would hide the difference between "no Template
 * was recorded" and "this response is not the shape it claims".
 */
for (const [label, body] of [
  ['template ABSENT', (() => { const b = { ...DETAIL_BODY }; delete b.template; return b; })()],
  ['member_count absent', (() => { const b = { ...DETAIL_BODY }; delete b.member_count; return b; })()],
  ['member_count not an integer', { ...DETAIL_BODY, member_count: 2.5 }],
  ['member_count negative', { ...DETAIL_BODY, member_count: -1 }],
  ['member_count a string', { ...DETAIL_BODY, member_count: '3' }],
  ['an enveloped detail body', { data: DETAIL_BODY }],
  ['a template missing a level label', { ...DETAIL_BODY, template: { template_id: 'tp_x', name: 'S', level_labels: { organization: 'G', workspace: 'C' } } }],
]) {
  try {
    parseOrganizationDetail(body);
    failures += 1;
    console.log(`FAIL  ${label} is refused\n        expected a throw, got none`);
  } catch {
    console.log(`PASS  ${label} is refused`);
  }
}

console.log('\n=== Organization detail: one request, no extra calls ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse(DETAIL_BODY));
  await createPlatformClient({ fetchImpl: impl }).readOrganization('og_abc');
  check('read puts the id in the PATH', calls[0].url, '/api/v1/platform/organizations/og_abc');
  check('read is a GET', calls[0].init.method, 'GET');
  check('read sends no body', calls[0].init.body, undefined);
  /*
   * THE ONE-PAGE-ONE-REQUEST RULE. The Template is embedded, so rendering the
   * page must not fetch it. A read costs writes in this class and a three-request
   * page spends three times the budget.
   */
  check('rendering the page costs exactly ONE call', calls.length, 1);
}

{
  const { impl, calls } = stubFetch(jsonResponse(DETAIL_BODY));
  await createPlatformClient({ fetchImpl: impl }).readOrganization('a/b?c=d');
  check(
    'a hostile organization id is percent-encoded, not injected',
    calls[0].url,
    '/api/v1/platform/organizations/a%2Fb%3Fc%3Dd',
  );
}

console.log('\n=== The resolve: exactly one field, no confirmation ===\n');

const RESOLVE_BODY = { principal_id: 'pr_synthetic_0000000001', role: 'owner' };

const resolved = parseResolveMember(RESOLVE_BODY);
check('principal_id', resolved.principal_id, 'pr_synthetic_0000000001');
check('role', resolved.role, 'owner');
checkTrue('owner is a known role', isKnownMembershipRole('owner'));
checkTrue('member is a known role', isKnownMembershipRole('member'));
check('an invented role is NOT claimed as known', isKnownMembershipRole('admin'), false);

{
  const { impl, calls } = stubFetch(jsonResponse(RESOLVE_BODY));
  await createPlatformClient({ fetchImpl: impl }).resolveMember('og_abc', 'someone@example.com');
  check(
    'the Organization is a PATH parameter, not a body field',
    calls[0].url,
    '/api/v1/platform/organizations/og_abc/members/resolve',
  );
  check('resolve is a POST', calls[0].init.method, 'POST');
  const sent = JSON.parse(calls[0].init.body);
  /*
   * `resolveMemberInput` IS `required: ['identifier']` WITH
   * `additionalProperties: false`. A confirmation token here would be a
   * validation failure, not a courtesy — AND gating the resolve would deadlock
   * the credential reset, because the principal_id this route returns is
   * precisely what the reset's confirmation must name.
   */
  check('exactly one field is sent', Object.keys(sent).join(','), 'identifier');
  for (const forbidden of ['confirmation', 'confirmation_token', 'organization_id', 'principal_id', 'role']) {
    check(`"${forbidden}" is NOT sent`, forbidden in sent, false);
  }
  check('resolve costs exactly ONE call', calls.length, 1);
}

console.log('\n=== The resolve: the collapsed refusal ===\n');

/*
 * THE ANTI-ENUMERATION PROPERTY, ASSERTED FROM THE CLIENT SIDE.
 *
 * Core collapses five conditions into one argument-free 404. This client cannot
 * verify Core's half — but it CAN verify that it does not rebuild the oracle:
 * that every 404 produces one indistinguishable outcome no matter what the
 * envelope carries. A future edit that read `details` or `message` on this path
 * would fail here.
 */
const REFUSAL_ENVELOPES = [
  ['a bare 404', { error: { code: 'not_found', message: '', request_id: 'rq_1' } }],
  ['a 404 with a message', { error: { code: 'not_found', message: 'no such principal', request_id: 'rq_2' } }],
  [
    'a 404 carrying DETAILS that name the cause',
    {
      error: {
        code: 'not_found',
        message: 'x',
        request_id: 'rq_3',
        details: [{ field: 'identifier', issue: 'principal_is_platform_operator' }],
      },
    },
  ],
];

const refusalShapes = [];
for (const [label, envelope] of REFUSAL_ENVELOPES) {
  const { impl } = stubFetch(jsonResponse(envelope, 404));
  try {
    await createPlatformClient({ fetchImpl: impl }).resolveMember('og_abc', 'a@example.com');
    failures += 1;
    console.log(`FAIL  ${label} should reject`);
  } catch (thrown) {
    check(`${label} maps to not_found`, thrown.code, 'not_found');
    refusalShapes.push(thrown.code);
  }
}
check(
  'every refusal envelope produces the SAME code, whatever it carried',
  new Set(refusalShapes).size,
  1,
);

/*
 * AND THE SCREEN'S OWN GUARANTEE, ASSERTED AGAINST THE SOURCE.
 *
 * `OrganizationDetail.tsx` maps every `not_found` to `{ kind: 'refused' }`,
 * which carries NO payload — so nothing downstream can branch on the cause,
 * because nothing downstream has it. These are structural checks on the file
 * rather than on a value, because the property is "there is no code that could
 * do otherwise" and that is a claim about the source.
 */
console.log('\n=== The screen cannot rebuild the oracle ===\n');

const screen = readFileSync(
  join(import.meta.dirname, '..', 'src', 'screens', 'OrganizationDetail.tsx'),
  'utf8',
);
const screenCode = screen.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

checkTrue(
  "the refused state carries no payload (`kind: 'refused'` with no fields)",
  /\{\s*readonly kind:\s*'refused'\s*\}/.test(screen),
);
check(
  'there is exactly ONE refusal string constant',
  (screenCode.match(/\bconst REFUSAL\b/g) ?? []).length,
  1,
);
check(
  'the refusal string is referenced exactly once when rendering',
  (screenCode.match(/\{REFUSAL\}/g) ?? []).length,
  1,
);
check('the screen logs nothing at all', /console\s*\./.test(screenCode), false);
check(
  'the screen never reads `details` (which could name the cause)',
  /\.details\b/.test(screenCode),
  false,
);
/*
 * A REQUEST ID ON THE REFUSAL WOULD NOT LEAK THE CAUSE, BUT IT WOULD MAKE THE
 * FIVE CASES SEPARABLE BY ANYONE WHO CAN READ CORE'S LOGS — and it would give a
 * future author a value to branch on. `refused` carries no error, so this is
 * enforced by the type; the check states it so removing the type guarantee
 * cannot pass silently.
 */
check(
  "the refused branch has no error object to read a request id from",
  /kind:\s*'refused',\s*(error|request_id)/.test(screenCode),
  false,
);
checkTrue(
  'forbidden is a SEPARATE state from refused',
  /kind:\s*'forbidden'/.test(screenCode) && /kind:\s*'refused'/.test(screenCode),
);
/*
 * NO SPECULATIVE CALLS. Every resolve writes a tenant-side audit record into the
 * customer's own log, including refusals, so the call fires on submit and
 * nowhere else.
 */
check(
  'the resolve is not wired to typing (no onChange-triggered lookup)',
  /onChange[\s\S]{0,400}resolveMember/.test(screenCode),
  false,
);
check(
  'the detail read is not polled (no interval or focus listener)',
  /setInterval|addEventListener\(\s*['"](focus|visibilitychange|online)/.test(screenCode),
  false,
);

/* -------------------------------------------------------------------------
   THE LOCAL REFUSAL MUST NOT LOOK LIKE THE SERVER REFUSAL
   -------------------------------------------------------------------------
   Core's accepted identifier set is strictly LARGER than the set this console
   can submit: `normalizeIdentifier` is NFKC plus an ASCII-only case fold and
   NORMALISES non-ASCII rather than rejecting it, while this console refuses
   every code point outside 0x21-0x7E.

   So a lookup can fail because THE CONSOLE CANNOT TYPE THE ADDRESS, and to an
   operator that is indistinguishable from THE PERSON NOT EXISTING — unless the
   two are visibly different. Same-looking is correct for the five server cases
   and WRONG here, because this one is a statement about the console.

   The asymmetry itself is routed to architecture and is not fixed here. What is
   asserted here is that the console does not let the two collapse together.
   ------------------------------------------------------------------------- */

const nonAsciiSentinel = identifierRefusal(`${String.fromCharCode(0x00e9)}@example.com`);
checkTrue(
  'the shared check still refuses a non-ASCII identifier',
  typeof nonAsciiSentinel === 'string' && nonAsciiSentinel.length > 0,
);
checkTrue(
  'and its shared wording is about SIGNING IN, which is why this screen re-words it',
  /sign you in/.test(nonAsciiSentinel ?? ''),
);
checkTrue(
  'the screen derives that sentinel from the real function, not a copied literal',
  /NON_ASCII_SENTINEL\s*=\s*identifierRefusal\(/.test(screenCode),
);
checkTrue(
  'the screen substitutes its own non-ASCII wording',
  /NON_ASCII_LOOKUP_REFUSAL/.test(screenCode),
);
check(
  'the shared sign-in wording is NOT hard-coded as a literal in the screen',
  screen.includes('sign you in'),
  false,
);

/*
 * The two texts must differ, and the local one must name the CONSOLE as the
 * limitation rather than making a claim about the member.
 */
const localRefusal = /const NON_ASCII_LOOKUP_REFUSAL\s*=\s*([\s\S]*?);\n/.exec(screen)?.[1] ?? '';
const serverRefusal = /const REFUSAL\s*=\s*([\s\S]*?);\n/.exec(screen)?.[1] ?? '';
checkTrue('both refusal texts were found in the source', localRefusal !== '' && serverRefusal !== '');
check('the local and server refusals are DIFFERENT strings', localRefusal === serverRefusal, false);
checkTrue(
  'the local refusal names the console as the limit',
  /this console|this screen/i.test(localRefusal),
);
checkTrue(
  'the local refusal disclaims any statement about the member',
  /says nothing about|nothing was looked up/i.test(localRefusal),
);
/*
 * AND THEY MUST NOT SHARE A RENDERING PATH. The local refusal goes into the
 * `Field`'s error slot — scarlet, iconed, attached to the input, above the
 * button. The server refusal renders in a neutral block below it. If a future
 * edit routed the local one through `{ kind: 'refused' }`, they would become
 * indistinguishable and this check is what would notice.
 */
check(
  'a local refusal never sets the server-refusal state',
  /setLocalError[\s\S]{0,200}kind:\s*'refused'/.test(screenCode),
  false,
);
checkTrue(
  'the local refusal is rendered through the field error slot',
  /error=\{localError\}/.test(screenCode),
);

console.log('');
if (failures > 0) {
  console.error(`${String(failures)} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
