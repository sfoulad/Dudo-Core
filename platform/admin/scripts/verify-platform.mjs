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
  parseOrganizationFeed,
  parsePlatformFeed,
  parseListOperators,
  parseResolveMember,
  parseOrganizationIdentity,
  parseRegistrationRecord,
  isKnownAuditOutcome,
  isKnownPlatformRole,
  isKnownRegistrationState,
  displayNameRefusal,
  registrationNumberRefusal,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_REGISTRATION_NUMBER_LENGTH,
  toUtcExclusiveDayEnd,
  toUtcDayStart,
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
import { ApiError, ERROR_CODES, writeIsCertainlyAbsent } from '../src/api/errors.ts';
import {
  MAX_WINDOW_DAYS,
  describeWindowRefusal,
  shiftWindowByOwnLength,
  spanInDays,
  windowIsRequired,
  windowRefusal,
  windowRefusalToken,
} from '../src/api/audit-window.ts';
import {
  buildConfirmedRequest,
  declaredPathParameters,
  isPresentableStatement,
  parseConfirmationChallenge,
  withConfirmation,
} from '../src/api/confirmation.ts';

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

/*
 * `commercial_registration` AND `vat_registration` WERE ADDED TO THIS RESPONSE
 * ON 2026-09-07 by `organization-identity-v1`, and both are in `required`. They
 * are `not_recorded` here, which is the state every existing Organization is in
 * — "nobody has asked", which is a different fact from "they have none".
 */
const DETAIL_BODY = {
  organization_id: 'og_synthetic_0000000001',
  status: 'active',
  created_at: '2026-09-05T09:00:00Z',
  display_name: null,
  commercial_registration: { state: 'not_recorded' },
  vat_registration: { state: 'not_recorded' },
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
  /*
   * BOTH REGISTRATIONS ARE REQUIRED. A response missing one is refused rather
   * than rendered as `not_recorded` — "nobody has asked" and "this response is
   * not the shape it claims" are different facts, and only one is safe to show
   * an operator about a customer.
   */
  ['commercial_registration ABSENT', (() => { const b = { ...DETAIL_BODY }; delete b.commercial_registration; return b; })()],
  ['vat_registration ABSENT', (() => { const b = { ...DETAIL_BODY }; delete b.vat_registration; return b; })()],
  ['a registration with no state', { ...DETAIL_BODY, vat_registration: {} }],
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
   * `resolveMemberInput` IS ONE FIELD WITH `additionalProperties: false`. A
   * confirmation token here would be a validation failure, not a courtesy — AND
   * gating the resolve would deadlock the credential reset, because the
   * principal_id this route returns is precisely what the reset's confirmation
   * must name.
   *
   * *** THE FIELD IS `target_identifier` SINCE 2026-09-07, AND `identifier` IS
   * NOW FORBIDDEN RATHER THAN MERELY UNUSED. *** `architecture.md` §1a: a bare
   * `identifier` is one word two contracts can each use correctly while meaning
   * different people — `confirmation-v1` injects `reauth_identifier`, the
   * CALLER'S own, into request shapes it does not own. This one is the
   * TARGET'S, so it says whose.
   *
   * SENDING BOTH IS REFUSED BY CORE with `must_not_send_both_names`, because if
   * the two values differ, choosing silently is choosing which principal to
   * resolve. The check below asserts the legacy name is absent, not merely that
   * the new one is present — those are different assertions and only the first
   * catches a body that carries both.
   */
  check('exactly one field is sent', Object.keys(sent).join(','), 'target_identifier');
  check('the value is the identifier the operator typed', sent.target_identifier, 'someone@example.com');
  /*
   * `identifier` IS IN THIS LIST DELIBERATELY. Phase 3 has Core and the
   * contract drop the legacy name in one change; until then Core accepts both,
   * so a client that sent both would be refused and a client that sent only the
   * old one would still work — which is exactly the state in which a
   * half-finished revert goes unnoticed.
   */
  for (const forbidden of ['identifier', 'confirmation', 'confirmation_token', 'organization_id', 'principal_id', 'role']) {
    check(`"${forbidden}" is NOT sent`, forbidden in sent, false);
  }
  /*
   * AN EXPLICIT NULL IS NOT AN OMITTED FIELD. Core's reading side had this
   * hazard — `target_identifier ?? identifier` treats an explicit null as
   * absent, so `{target_identifier: null, identifier: 'x'}` slips past a
   * both-present check and quietly resolves the legacy value. The client's
   * mirror image is a conditionally-built body; this asserts the value is a
   * real string, so a body that ever sent `null` turns red here.
   */
  check('and it is a string, never null', typeof sent.target_identifier, 'string');
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
        details: [{ field: 'target_identifier', issue: 'principal_is_platform_operator' }],
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
/*
 * Checked against `screenCode` — comments stripped — because the concern is a
 * hard-coded literal IN CODE, which would go stale when `platform/web` rewords
 * the shared sentence. Prose describing the situation is not the hazard.
 *
 * (The first version of this check scanned the raw source and failed on the
 * screen's own explanatory comment, which quoted the sentence. The comment now
 * paraphrases instead, so neither copy can go stale — but the check still reads
 * code, because that is what it is actually about.)
 */
check(
  'the shared sign-in wording is NOT hard-coded as a literal in the screen',
  screenCode.includes('sign you in'),
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

/* =========================================================================
   9. THE AUDIT FEEDS — platform-audit-read-v1
   ========================================================================= */

console.log('\n=== The two feeds differ by exactly one field ===\n');

const COMMON = {
  record_id: 'rc_synthetic_0000000001',
  occurred_at: '2026-09-05T10:00:00Z',
  actor_principal_id: 'pr_synthetic_0000000001',
  actor_platform_role: 'platform-admin',
  action_id: 'platform.credentials.reset',
  outcome: 'succeeded',
  correlation_id: 'co_synthetic_0000000001',
};

const PLATFORM_RECORD = { ...COMMON, target_organization_id: 'og_synthetic_0000000001' };
const ORG_RECORD = { ...COMMON, target_principal_id: 'pr_synthetic_0000000002' };

const platformPage = parsePlatformFeed({ data: [PLATFORM_RECORD], next_cursor: null });
check('platform feed: data is top-level', platformPage.data.length, 1);
check('platform feed: the Organization target', platformPage.data[0].target_organization_id, 'og_synthetic_0000000001');
check('platform feed: a null Organization target parses', parsePlatformFeed({ data: [{ ...COMMON, target_organization_id: null }], next_cursor: null }).data[0].target_organization_id, null);

/*
 * THE ASSERTION THE WHOLE CONTRACT TURNS ON, FROM THE CLIENT SIDE. Even when
 * Core hands the platform parser a record that CARRIES `target_principal_id`,
 * the parsed value must not contain one — the field never enters the client's
 * memory, let alone its render tree.
 */
const smuggled = parsePlatformFeed({
  data: [{ ...PLATFORM_RECORD, target_principal_id: 'pr_should_never_appear' }],
  next_cursor: null,
});
check(
  'platform feed: a smuggled target_principal_id is NOT carried through',
  'target_principal_id' in smuggled.data[0],
  false,
);
check(
  'and it is nowhere in the serialised parsed page',
  JSON.stringify(smuggled).includes('pr_should_never_appear'),
  false,
);

const orgPage = parseOrganizationFeed({ data: [ORG_RECORD], next_cursor: null });
check('Organization feed: the principal target IS carried', orgPage.data[0].target_principal_id, 'pr_synthetic_0000000002');
check('Organization feed: a null principal target parses', parseOrganizationFeed({ data: [{ ...COMMON, target_principal_id: null }], next_cursor: null }).data[0].target_principal_id, null);
check(
  'Organization feed: no target_organization_id is carried (the path fixed it)',
  'target_organization_id' in orgPage.data[0],
  false,
);

for (const field of ['record_id', 'occurred_at', 'actor_principal_id', 'actor_platform_role', 'action_id', 'outcome', 'correlation_id']) {
  const body = { ...PLATFORM_RECORD };
  delete body[field];
  try {
    parsePlatformFeed({ data: [body], next_cursor: null });
    failures += 1;
    console.log(`FAIL  a record missing "${field}" is refused\n        expected a throw, got none`);
  } catch {
    console.log(`PASS  a record missing "${field}" is refused`);
  }
}

try {
  parsePlatformFeed({ data: [{ ...COMMON }], next_cursor: null });
  failures += 1;
  console.log('FAIL  a platform record missing target_organization_id is refused\n        expected a throw');
} catch {
  console.log('PASS  a platform record missing target_organization_id is refused (required, nullable)');
}
try {
  parseOrganizationFeed({ data: [{ ...COMMON }], next_cursor: null });
  failures += 1;
  console.log('FAIL  an Organization record missing target_principal_id is refused\n        expected a throw');
} catch {
  console.log('PASS  an Organization record missing target_principal_id is refused (required, nullable)');
}

console.log('\n=== The feeds: requests, filters and paging ===\n');

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listPlatformAudit();
  check('platform feed path', calls[0].url, '/api/v1/platform/audit');
  check('it is a GET', calls[0].init.method, 'GET');
  check('no body', calls[0].init.body, undefined);
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listPlatformAudit({
    pageSize: 25,
    filters: {
      actor_principal_id: 'pr_a',
      action_id: 'platform.audit.list',
      /*
       * DERIVED FROM THE HELPERS, NOT HAND-WRITTEN. These literals previously
       * read `2026-09-01T00:00:00Z` and `…T23:59:59.999Z` — copied by hand, and
       * the first was the exact defective form the screens were sending. A
       * fixture that hard-codes what it expects can pass while the code under
       * it sends something else, which is what happened here.
       */
      since: toUtcDayStart('2026-09-01'),
      until: toUtcExclusiveDayEnd('2026-09-05'),
    },
  });
  const url = calls[0].url;
  checkTrue('actor_principal_id IS sent on the platform feed', url.includes('actor_principal_id=pr_a'));
  checkTrue('action_id is sent', url.includes('action_id=platform.audit.list'));
  checkTrue(
    'since is sent with three fractional digits',
    url.includes(`since=${encodeURIComponent(toUtcDayStart('2026-09-01'))}`),
  );
  checkTrue(
    'until is the NEXT day at .000, not an inclusive end',
    url.includes(`until=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`),
  );
  check('no target_principal_id parameter is ever sent', url.includes('target_principal_id'), false);
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listOrganizationAudit('og_abc', {
    pageSize: 25,
    filters: { action_id: 'x' },
  });
  checkTrue(
    'Organization feed path includes the id and /audit',
    calls[0].url.startsWith('/api/v1/platform/organizations/og_abc/audit?'),
  );
  check('and no target_principal_id parameter', calls[0].url.includes('target_principal_id'), false);
  check('and no actor_principal_id parameter (not accepted here)', calls[0].url.includes('actor_principal_id'), false);
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listOrganizationAudit('a/b', {});
  check(
    'a hostile organization id is percent-encoded',
    calls[0].url,
    '/api/v1/platform/organizations/a%2Fb/audit',
  );
}

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listPlatformAudit({ pageSize: 25, cursor: null });
  check('a null cursor is omitted', calls[0].url, '/api/v1/platform/audit?page_size=25');
}

console.log('\n=== The UTC day helpers ===\n');

/*
 * THE FORMAT IS NOW SPECIFIED: RFC 3339 UTC with EXACTLY THREE fractional
 * digits, and the interval is HALF-OPEN `[since, until)`.
 *
 * THE WIDTH IS A CORRECTNESS RULE. Comparison against stored timestamps is
 * lexicographic, which equals temporal comparison only when both operands are
 * the same width: at index 19 a stored value has `.` (0x2E) and a bound with no
 * fractional part has `Z` (0x5A), and `.` sorts first. So a bound written
 * without milliseconds shifts FORWARD by up to a second —
 * `since=…T00:00:00Z` silently drops every record in second 00, which is what
 * this console was shipping.
 */

check('the day start carries .000', toUtcDayStart('2026-09-05'), '2026-09-05T00:00:00.000Z');
check(
  'the exclusive end is the NEXT day at .000',
  toUtcExclusiveDayEnd('2026-09-05'),
  '2026-09-06T00:00:00.000Z',
);

/* THE WIDTH RULE, ASSERTED ON THE OUTPUT RATHER THAN TRUSTED. */
for (const [label, value] of [
  ['start', toUtcDayStart('2026-09-05')],
  ['exclusive end', toUtcExclusiveDayEnd('2026-09-05')],
]) {
  checkTrue(
    `the ${label} has exactly three fractional digits`,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value ?? ''),
  );
  check(`the ${label} is 24 characters, the stored width`, (value ?? '').length, 24);
}

/*
 * THE HALF-OPEN INTERVAL COVERS THE WHOLE DAY AND NOTHING MORE. A record at the
 * first instant is included; one at the last is included; the next day's first
 * instant is not.
 */
{
  const since = new Date(toUtcDayStart('2026-09-05')).getTime();
  const until = new Date(toUtcExclusiveDayEnd('2026-09-05')).getTime();
  const at = (v) => new Date(v).getTime();
  checkTrue('the first instant of the day is included', at('2026-09-05T00:00:00.000Z') >= since);
  checkTrue('a record in second 00 is included', at('2026-09-05T00:00:00.500Z') >= since);
  checkTrue('the last instant of the day is included', at('2026-09-05T23:59:59.999Z') < until);
  checkTrue('the next day is excluded', at('2026-09-06T00:00:00.000Z') >= until);
  check('the window is exactly one day', until - since, 86_400_000);
}

/*
 * THE REGRESSIONS THIS REPLACED, ASSERTED SO THEY CANNOT RETURN SILENTLY.
 */
checkTrue(
  'the superseded T00:00:00Z sorts AFTER a record in second 00 (the shipped defect)',
  '2026-09-05T00:00:00Z' > '2026-09-05T00:00:00.500Z',
);
checkTrue(
  'and the superseded T23:59:59.999Z would exclude the final millisecond under a half-open end',
  !(at2('2026-09-05T23:59:59.999Z') < at2('2026-09-05T23:59:59.999Z')),
);
function at2(v) {
  return new Date(v).getTime();
}

/*
 * DAY, MONTH AND YEAR ROLLOVER — the exclusive end is the next day, so these are
 * the boundaries a hand-built string would get wrong.
 */
check('month rollover', toUtcExclusiveDayEnd('2026-09-30'), '2026-10-01T00:00:00.000Z');
check('year rollover', toUtcExclusiveDayEnd('2026-12-31'), '2027-01-01T00:00:00.000Z');
check('february in a non-leap year', toUtcExclusiveDayEnd('2026-02-28'), '2026-03-01T00:00:00.000Z');
check('february in a leap year', toUtcExclusiveDayEnd('2028-02-28'), '2028-02-29T00:00:00.000Z');
check('and the leap day itself', toUtcExclusiveDayEnd('2028-02-29'), '2028-03-01T00:00:00.000Z');

/*
 * A WELL-FORMED BUT NON-EXISTENT DATE IS REFUSED rather than normalised into a
 * range the operator did not ask for.
 */
check('a non-existent date is refused, not slid into March', toUtcDayStart('2026-02-31'), null);
check('and so is its exclusive end', toUtcExclusiveDayEnd('2026-02-31'), null);

/*
 * THE EQUAL-BOUNDS CASE. A zero-width half-open interval returns nothing, so a
 * single-day pick must not produce equal bounds. CONFIRMED HERE rather than
 * taken on assurance.
 */
{
  const since = toUtcDayStart('2026-09-05');
  const until = toUtcExclusiveDayEnd('2026-09-05');
  check('one date for both ends does NOT produce equal bounds', since === until, false);
  checkTrue('and they differ by exactly one day', new Date(until).getTime() - new Date(since).getTime() === 86_400_000);
}
check('an empty date yields null, so nothing is sent', toUtcDayStart(''), null);
check('a zoneless datetime is NOT accepted as a calendar date', toUtcDayStart('2026-09-05T10:00'), null);
check('a malformed date yields null', toUtcExclusiveDayEnd('05/09/2026'), null);
checkTrue(
  'every produced timestamp ends in Z',
  [toUtcDayStart('2026-01-01'), toUtcExclusiveDayEnd('2026-12-31')].every(
    (v) => v !== null && v.endsWith('Z'),
  ),
);

console.log('\n=== Operators: three fields and nothing else ===\n');

const OPERATOR = {
  principal_id: 'pr_synthetic_0000000001',
  platform_role: 'platform-admin',
  created_at: '2026-09-05T09:00:00Z',
};

const operators = parseListOperators({ data: [OPERATOR], next_cursor: null });
check('principal_id', operators.data[0].principal_id, 'pr_synthetic_0000000001');
check('platform_role', operators.data[0].platform_role, 'platform-admin');
check('created_at', operators.data[0].created_at, '2026-09-05T09:00:00Z');
check('an empty roster parses as a page, not an error', parseListOperators({ data: [], next_cursor: null }).data.length, 0);

/*
 * NO IDENTIFIER, NO EMAIL, NO DISPLAY NAME. `0001_principal.sql` refused an
 * email column because a directory of personal details readable without tenant
 * scope "would be the highest-value target in the system", and an operator
 * roster showing addresses would be that directory at the most privileged end.
 * If Core ever sent one, this parser must not carry it.
 */
const rosterSmuggled = parseListOperators({
  data: [{ ...OPERATOR, identifier: 'someone@example.com', display_name: 'Sam' }],
  next_cursor: null,
});
check(
  'a smuggled identifier is NOT carried through',
  JSON.stringify(rosterSmuggled).includes('someone@example.com'),
  false,
);
check('nor a display name', JSON.stringify(rosterSmuggled).includes('Sam'), false);

{
  const { impl, calls } = stubFetch(jsonResponse({ data: [], next_cursor: null }));
  await createPlatformClient({ fetchImpl: impl }).listOperators({ pageSize: 25 });
  check('operators path', calls[0].url, '/api/v1/platform/operators?page_size=25');
  check('it is a GET', calls[0].init.method, 'GET');
}

checkTrue('platform-admin is a known role', isKnownPlatformRole('platform-admin'));
checkTrue('marketplace-moderator is a known role', isKnownPlatformRole('marketplace-moderator'));
check('an invented role is not claimed as known', isKnownPlatformRole('root'), false);
checkTrue('succeeded is a known outcome', isKnownAuditOutcome('succeeded'));
checkTrue('failed is a known outcome', isKnownAuditOutcome('failed'));
check('an invented outcome is not claimed as known', isKnownAuditOutcome('partial'), false);

/* =========================================================================
   10. STRUCTURAL — the screens cannot undo the contract's properties
   ========================================================================= */

console.log('\n=== The screens: structural guarantees ===\n');

const readScreen = (name) =>
  readFileSync(join(import.meta.dirname, '..', 'src', 'screens', name), 'utf8');
const strip = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const platformScreen = strip(readScreen('PlatformAudit.tsx'));
const orgAuditScreen = strip(readScreen('OrganizationAudit.tsx'));
const operatorsScreen = strip(readScreen('Operators.tsx'));
const auditList = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'AuditRecordList.tsx'), 'utf8'),
);

check(
  'the platform screen never mentions target_principal_id',
  /target_principal_id/.test(platformScreen),
  false,
);
/*
 * THE SHARED LIST COMPONENT MUST NOT KNOW EITHER TARGET FIELD. It receives
 * `AuditRecordCommon` plus a caller-supplied callback, so it cannot reach a
 * field its caller did not hand it — that is what keeps one component from
 * becoming the `if` the two routes exist to avoid.
 */
check('the shared list never names target_principal_id', /target_principal_id/.test(auditList), false);
check('the shared list never names target_organization_id', /target_organization_id/.test(auditList), false);
checkTrue('the shared list takes a renderTarget callback', /renderTarget/.test(auditList));

/* No polling anywhere on the audited screens. */
for (const [label, source] of [
  ['platform audit', platformScreen],
  ['Organization audit', orgAuditScreen],
  ['operators', operatorsScreen],
]) {
  check(
    `${label}: no interval or focus/reconnect refetch`,
    /setInterval|addEventListener\(\s*['"](focus|visibilitychange|online)/.test(source),
    false,
  );
}

/*
 * THE ORGANIZATION FEED MUST NOT FETCH ON MOUNT. Opening it spends five writes
 * from a customer's daily allowance, so arriving at the address — or landing
 * there from a mistyped link — must cost them nothing.
 */
checkTrue(
  'the Organization feed does not load until a person asks',
  /if\s*\(\s*nonce\s*===\s*0\s*\)\s*return/.test(orgAuditScreen),
);
check(
  'the Organization feed offers no actor filter',
  /actor_principal_id/.test(orgAuditScreen),
  false,
);

/* The two ceilings must be rendered as different statements. */
const ceiling = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'CeilingNotice.tsx'), 'utf8'),
);
checkTrue('the ceiling notice distinguishes the two codes', /rate_limited/.test(ceiling) && /quota_exceeded/.test(ceiling));
checkTrue('and branches its wording on which one', /isRateLimit/.test(ceiling));
check(
  'quota_exceeded is not given an automatic retry',
  /onRetry\s*&&\s*!isRateLimit/.test(ceiling),
  false,
);

/*
 * REVOKE, AND THE CONSTRAINT THAT REPLACED "IT DOES NOT EXIST".
 *
 * These two checks previously asserted that no screen called revoke and that the
 * client exposed no method for it — correct while the confirmation flow was
 * unbuilt and the Team Lead had ruled it out of scope. **That ruling was
 * withdrawn when the flow was commissioned**, so asserting the old constraint
 * would have been `workflow.md` §12's exact shape: a test enforcing a decision
 * that no longer holds, which the natural fix makes pass by removing the
 * feature.
 *
 * WHAT IS ASSERTED INSTEAD IS THE CONSTRAINT THAT SURVIVED: revoke exists, and
 * it is reachable ONLY through the confirmation gate. A direct call — one that
 * did not carry the three fields — is what the old rule was really protecting
 * against.
 */
checkTrue(
  'the audit screens still make no revoke call',
  ![platformScreen, orgAuditScreen].some((source) =>
    /revokeOperator|\/revoke/.test(source),
  ),
);
checkTrue('the operators screen uses the confirmation gate', /ConfirmationGate/.test(operatorsScreen));
/*
 * EXACTLY ONE CALL SITE, and the next check pins where it is. Counting rather
 * than forbidding: the call inside the gate's `submit` handler is the correct
 * one, so a check that banned the identifier outright — as the first version of
 * this did — would have failed on the right implementation.
 */
check(
  'revoke has exactly one call site',
  (operatorsScreen.match(/revokeOperator\(/g) ?? []).length,
  1,
);
checkTrue(
  'revoke is submitted from inside the gate, carrying a confirmation',
  /submit=\{[\s\S]{0,400}revokeOperator\([\s\S]{0,300}\.\.\.confirmation/.test(
    strip(readScreen('Operators.tsx')),
  ),
);

/* =========================================================================
   11. CONFIRMATIONS — confirmation-v1
   ========================================================================= */

console.log('\n=== The binding: body-minus-three UNION path parameters ===\n');

check(
  'the path template is the declaration',
  declaredPathParameters('/api/v1/platform/operators/{principal_id}/revoke').join(','),
  'principal_id',
);
check('a template with no braces declares nothing', declaredPathParameters('/credentials/reset').length, 0);

/*
 * REVOKE: the body is empty, so the binding is the path parameter ALONE. Before
 * the union clause of 2026-09-05 this was the empty object and a confirmation
 * minted for operator A could have been spent on operator B.
 */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/api/v1/platform/operators/{principal_id}/revoke',
    pathValues: { principal_id: 'pr_target_0000000001' },
    bodyFields: {},
  });
  check('revoke binds exactly one parameter', Object.keys(built.parameters).join(','), 'principal_id');
  check('and it is the target', built.parameters.principal_id, 'pr_target_0000000001');
  check('the URL substitutes it', built.path, '/api/v1/platform/operators/pr_target_0000000001/revoke');
  check('the submission body is empty', Object.keys(built.bodyWithoutConfirmation).length, 0);
}

/* THE DECODED SEGMENT IS BOUND; THE ENCODED ONE GOES IN THE URL. */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/api/v1/platform/operators/{principal_id}/revoke',
    pathValues: { principal_id: 'a b/c' },
    bodyFields: {},
  });
  check('the bound value is the DECODED segment', built.parameters.principal_id, 'a b/c');
  checkTrue('the URL carries the encoded form', built.path.includes('a%20b%2Fc'));
  check('and the two differ, which is the point', built.parameters.principal_id === 'a%20b%2Fc', false);
}

/* A numeric-looking segment binds as a STRING and is never coerced. */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/x/{principal_id}',
    pathValues: { principal_id: '42' },
    bodyFields: {},
  });
  check('a numeric-looking segment binds as a string', typeof built.parameters.principal_id, 'string');
  check('and its value is "42", not 42', built.parameters.principal_id, '42');
}

/*
 * RESET: no path parameters, so the binding is body-minus-three — which
 * INCLUDES `derived_value`, the new credential. That is what forces the password
 * to be generated before the challenge.
 */
{
  const built = buildConfirmedRequest({
    pathTemplate: '/api/v1/platform/credentials/reset',
    pathValues: {},
    bodyFields: {
      principal_id: 'pr_x',
      target_identifier: 'someone@example.com',
      derived_value: 'A'.repeat(43),
    },
  });
  check(
    'reset binds all three body fields',
    Object.keys(built.parameters).sort().join(','),
    'derived_value,principal_id,target_identifier',
  );
  check('the path has no substitution', built.path, '/api/v1/platform/credentials/reset');
  check(
    'the submission body equals the bound parameters when there are no path parameters',
    JSON.stringify(Object.keys(built.bodyWithoutConfirmation).sort()),
    JSON.stringify(Object.keys(built.parameters).sort()),
  );
}

console.log('\n=== The binding refuses what would make it ambiguous ===\n');

for (const [label, input] of [
  [
    'a reserved name as a body field',
    { pathTemplate: '/x', pathValues: {}, bodyFields: { confirmation_id: 'c' } },
  ],
  [
    'a reserved name as a path parameter',
    { pathTemplate: '/x/{reauth_identifier}', pathValues: { reauth_identifier: 'a' }, bodyFields: {} },
  ],
  [
    'reauth_derived_value as a body field',
    { pathTemplate: '/x', pathValues: {}, bodyFields: { reauth_derived_value: 'v' } },
  ],
  [
    'a name that is both a path parameter and a body field',
    { pathTemplate: '/x/{principal_id}', pathValues: { principal_id: 'a' }, bodyFields: { principal_id: 'b' } },
  ],
  [
    'a declared path parameter with no value',
    { pathTemplate: '/x/{principal_id}', pathValues: {}, bodyFields: {} },
  ],
  [
    'a path value the template does not declare',
    { pathTemplate: '/x', pathValues: { principal_id: 'a' }, bodyFields: {} },
  ],
]) {
  try {
    buildConfirmedRequest(input);
    failures += 1;
    console.log(`FAIL  ${label} is refused\n        expected a throw, got none`);
  } catch {
    console.log(`PASS  ${label} is refused`);
  }
}

console.log('\n=== The challenge, and the locale this console never asks for ===\n');

const CHALLENGE = {
  confirmation_id: 'cf_synthetic_00000000001',
  statement: 'This will reset the password for principal pr_x and sign them out everywhere.',
  statement_locale: 'en',
  expires_at: '2026-09-05T10:05:00.000Z',
};

const parsedChallenge = parseConfirmationChallenge(CHALLENGE);
check('the statement is carried verbatim', parsedChallenge.statement, CHALLENGE.statement);
check('statement_locale is carried', parsedChallenge.statement_locale, 'en');
checkTrue('an English statement is presentable', isPresentableStatement(parsedChallenge));
check(
  'a NON-ENGLISH statement is NOT presentable, so no approve control is offered',
  isPresentableStatement({ ...parsedChallenge, statement_locale: 'ar' }),
  false,
);

for (const field of ['confirmation_id', 'statement', 'statement_locale', 'expires_at']) {
  const body = { ...CHALLENGE };
  delete body[field];
  try {
    parseConfirmationChallenge(body);
    failures += 1;
    console.log(`FAIL  a challenge missing "${field}" is refused\n        expected a throw`);
  } catch {
    console.log(`PASS  a challenge missing "${field}" is refused`);
  }
}

{
  const { impl, calls } = stubFetch(jsonResponse(CHALLENGE, 201));
  await createPlatformClient({ fetchImpl: impl }).requestConfirmation({
    actionId: 'platform.credentials.reset',
    parameters: { principal_id: 'pr_x' },
  });
  check('the challenge path', calls[0].url, '/api/v1/platform/confirmations');
  check('it is a POST', calls[0].init.method, 'POST');
  const sent = JSON.parse(calls[0].init.body);
  check('exactly two fields are sent', Object.keys(sent).sort().join(','), 'action_id,parameters');
  /*
   * NO `locale` FIELD, EVER. Absent means English. The non-English statement
   * catalog has never been reviewed by a speaker of the language, and a human is
   * being asked to APPROVE the sentence.
   */
  check('no locale is requested', 'locale' in sent, false);
}

console.log('\n=== The submission: three fields merged, token echoed ===\n');

{
  const merged = withConfirmation(
    { principal_id: 'pr_x', target_identifier: 'a@b.co', derived_value: 'D'.repeat(43) },
    {
      confirmationId: 'cf_ISSUED_EXACTLY_THIS',
      reauthIdentifier: 'operator@example.com',
      reauthDerivedValue: 'R'.repeat(43),
    },
  );
  check(
    'the three confirmation fields are MERGED, not wrapped',
    Object.keys(merged).sort().join(','),
    'confirmation_id,derived_value,principal_id,reauth_derived_value,reauth_identifier,target_identifier',
  );
  check('the token is echoed byte-for-byte', merged.confirmation_id, 'cf_ISSUED_EXACTLY_THIS');
  check('no envelope key is introduced', 'confirmation' in merged, false);
}

{
  const { impl, calls } = stubFetch(
    jsonResponse({ principal_id: 'pr_x', was_self: false, remaining_operator_count: 2 }),
  );
  await createPlatformClient({ fetchImpl: impl }).revokeOperator({
    path: '/api/v1/platform/operators/pr_x/revoke',
    bodyWithoutConfirmation: {},
    confirmationId: 'cf_a',
    reauthIdentifier: 'op@example.com',
    reauthDerivedValue: 'R'.repeat(43),
  });
  const sent = JSON.parse(calls[0].init.body);
  check('revoke sends only the three fields', Object.keys(sent).sort().join(','), 'confirmation_id,reauth_derived_value,reauth_identifier');
  check('and no target in the body — it is the path', 'principal_id' in sent, false);
}

console.log('\n=== The password never leaves, and is never named ===\n');

const gate = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ConfirmationGate.tsx'), 'utf8'),
);
const resetScreen = strip(readScreen('ResetCredential.tsx'));
const confirmationModule = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'confirmation.ts'), 'utf8'),
);

for (const [label, source] of [
  ['the confirmation gate', gate],
  ['the reset screen', resetScreen],
  ['the confirmation module', confirmationModule],
]) {
  check(`${label} logs nothing`, /console\s*\./.test(source), false);
  check(
    `${label} never persists anything`,
    /(localStorage|sessionStorage)\s*\.\s*setItem/.test(source),
    false,
  );
}

/* The typed password is cleared before the submission is sent. */
checkTrue(
  'the gate clears the password before submitting',
  /setPassword\(''\);[\s\S]{0,200}setPhase\(\{\s*kind:\s*'submitting'/.test(gate),
);
checkTrue('and clears it on every failure path', /catch[\s\S]{0,120}setPassword\(''\)/.test(gate));

/* THE STATEMENT IS RENDERED VERBATIM — one interpolation, no transformation. */
checkTrue('the statement is rendered as a bare interpolation', /\{challenge\.statement\}/.test(gate));
check(
  'the statement is never transformed',
  /statement\s*\.\s*(replace|slice|toUpperCase|toLowerCase|trim|split|substring|normalize)/.test(gate),
  false,
);
check(
  'and never composed from the parameters',
  /statement\s*=\s*[`'"]|`[^`]*\$\{[^}]*parameters/.test(gate),
  false,
);

/* No speculative challenges. */
check(
  'the gate requests no challenge on hover or focus',
  /onMouseEnter|onFocus[\s\S]{0,200}requestChallenge/.test(gate),
  false,
);
check(
  'the operators screen opens the gate only from a click',
  /onMouseEnter[\s\S]{0,200}setRevoking/.test(strip(readScreen('Operators.tsx'))),
  false,
);

/* The reset derives with the TARGET's identifier, the gate with the CALLER's. */
checkTrue(
  'the reset salts the new credential with the target identifier',
  /createOnboardingCredential\(targetIdentifier/.test(resetScreen),
);
check(
  'the reset screen never handles a reauth value itself',
  /reauth_derived_value|reauthDerivedValue\s*=/.test(resetScreen),
  false,
);

console.log('\n=== A reset that fails AFTER approval: refused vs unknown ===\n');

/*
 * THE DANGEROUS CASE IS NOT FAILURE, IT IS NOT KNOWING. Getting this wrong one
 * way hands a customer a password that was never written; the other way discards
 * the only copy of one that is live.
 */
checkTrue(
  'the reset distinguishes a refusal from an indeterminate outcome',
  /writeIsCertainlyAbsent/.test(resetScreen),
);
checkTrue(
  'a refusal and an unknown outcome are separate render paths',
  /certainlyNotWritten/.test(resetScreen),
);
/*
 * ON AN INDETERMINATE OUTCOME THE PASSWORD IS STILL SHOWN. If the write landed,
 * this browser holds the only copy; discarding it strands the account
 * permanently, while showing an inert string costs nothing.
 */
checkTrue(
  'the uncertain branch still renders the password',
  /ResetUncertain[\s\S]*?credential\.password/.test(resetScreen),
);
checkTrue(
  'and says plainly that it may or may not be live',
  /not known whether|possibly-live|Possibly-live/i.test(resetScreen),
);
/*
 * A SUBMISSION FAILURE IS NOT ROUTED THROUGH THE GATE'S GENERIC HANDLER, whose
 * "Nothing was changed" is true for a challenge that never issued and MAY BE
 * FALSE for a submission that timed out.
 */
checkTrue(
  'the reset catches its own submission failure rather than rethrowing',
  /catch\s*\([\s\S]{0,80}onFailedAfterApproval/.test(resetScreen),
);

/*
 * THE CLASSIFICATION ITSELF, EXERCISED RATHER THAN GREPPED. Refusals are
 * decisions Core made before writing; transport and server faults are not. This
 * calls the real function — a regex over the source would pass on a file that
 * merely mentions the codes.
 *
 * EVERY CODE IN THE ENVELOPE IS COVERED, so a new one cannot be added without
 * this failing and forcing a decision about which side it falls on. An
 * unclassified code defaulting to "nothing was written" is the dangerous
 * default, and this is what stops it arriving silently.
 */
{
  const certain = [
    'conflict',
    'quota_exceeded',
    'rate_limited',
    'forbidden',
    'not_found',
    'invalid_argument',
    'failed_precondition',
  ];
  const uncertain = ['unavailable', 'timeout', 'internal', 'unauthenticated'];

  for (const code of certain) {
    checkTrue(`${code} -> nothing was written`, writeIsCertainlyAbsent({ code }));
  }
  for (const code of uncertain) {
    check(`${code} -> outcome UNKNOWN, not "nothing happened"`, writeIsCertainlyAbsent({ code }), false);
  }
  check(
    'every error code in the envelope is classified',
    [...certain, ...uncertain].sort().join(','),
    [...ERROR_CODES].sort().join(','),
  );
}

/* And the reasoning that stops the ordering being "simplified" away. */
checkTrue(
  'the file records why derived_value must be generated before the challenge',
  /DO NOT "SIMPLIFY" THIS BY GENERATING THE PASSWORD AFTER THE CONFIRMATION/.test(
    readScreen('ResetCredential.tsx'),
  ),
);

/* =========================================================================
   12. ACCESSIBILITY — structure, roles and focus, asserted from the source
   =========================================================================
   WHAT THESE CAN AND CANNOT DO, STATED HERE SO THE COUNT IS NOT MISREAD.
   They assert that the STRUCTURE exists: roles, labels, associations, focus
   moves, explicit button types. **They cannot assert that a screen reader
   announces any of it well.** There is no browser and no assistive technology
   here. This is an accessibility PASS bounded to what a source check can see,
   not an accessibility CLAIM.
   ========================================================================= */

console.log('\n=== Buttons: an untyped button inside a form SUBMITS it ===\n');

/*
 * HTML's default is `type="submit"`. `ConfirmationGate`'s Cancel sat inside the
 * approval form untyped, so clicking it fired `onCancel` AND `onSubmit` — with
 * both re-auth fields filled it would have carried out the destructive action
 * the operator had just declined.
 */
const buttonSource = readFileSync(
  join(import.meta.dirname, '..', 'src', 'components', 'ui', 'button.tsx'),
  'utf8',
);
checkTrue(
  'Button defaults to type="button", so a control must ASK to submit',
  /type\s*=\s*'button'/.test(strip(buttonSource)),
);
checkTrue(
  'and the default is actually applied to the element',
  /<button\s+type=\{type\}/.test(strip(buttonSource)),
);

console.log('\n=== The confirmation flow ===\n');

/*
 * A STATEMENT A SCREEN READER SKIPS IS A STATEMENT NOBODY APPROVED. A paragraph
 * is not in the tab order, so someone tabbing to the password field would
 * otherwise hear nothing about what they are approving.
 */
checkTrue('the statement has an id that can be referenced', /id=\{statementId\}/.test(gate));
checkTrue(
  'the statement is the accessible description of its region',
  /aria-describedby=\{statementId\}[\s\S]{0,400}id=\{statementId\}/.test(gate),
);
checkTrue(
  'and of the approve control, so it is announced at the moment of decision',
  (gate.match(/aria-describedby=\{statementId\}/g) ?? []).length >= 2,
);
checkTrue(
  'focus moves to the statement when the challenge arrives',
  /statementRef\.current\?\.focus\(\)/.test(gate),
);
/*
 * GENERATED IDS. This component is used by two screens; a literal `id` would be
 * a duplicate if two ever coexisted, and `aria-describedby` resolves to the
 * FIRST match — announcing the wrong action's statement.
 */
checkTrue('the ids are generated, not literal', /useId\(\)/.test(gate));
check(
  'no hardcoded confirmation id remains',
  /id="confirmation-heading"/.test(gate),
  false,
);

console.log('\n=== The reset outcome panels are announced and focused ===\n');

for (const [label, pattern] of [
  ['the success panel is a live region', /role="status"[\s\S]{0,200}aria-live="polite"/],
  ['both outcome panels take focus', /panelRef\.current\?\.focus\(\)/],
  ['the uncertain panel is assertive', /role="alert"/],
]) {
  checkTrue(label, pattern.test(resetScreen));
}
checkTrue(
  'the possibly-live password is labelled as such for a screen reader',
  /Possibly-live password/.test(readScreen('ResetCredential.tsx')),
);

console.log('\n=== RTL: direction-dependent content ===\n');

/*
 * A LITERAL ARROW DOES NOT FLIP. In RTL "back" points right, and `&larr;` keeps
 * pointing left — aiming away from where the reader came from.
 */
for (const name of ['OrganizationAudit.tsx', 'PlatformAudit.tsx', 'Operators.tsx', 'Templates.tsx', 'SignIn.tsx', 'ResetCredential.tsx']) {
  const source = readScreen(name);
  check(
    `${name}: no hard-coded directional arrow`,
    /&larr;|&rarr;|←|→/.test(strip(source)),
    false,
  );
}
checkTrue(
  'the back control uses a mirroring icon instead',
  /rtl:-scale-x-100/.test(readScreen('OrganizationAudit.tsx')),
);

console.log('\n=== Landmarks, labels and focus order ===\n');

const shell = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'AdminShell.tsx'), 'utf8'),
);
checkTrue('the navigation is a labelled landmark', /<nav[\s\S]{0,200}aria-label="Sections"/.test(shell));
checkTrue('the main region is addressable by the skip link', /id="main"/.test(shell));
checkTrue('the skip link exists', /skip-link/.test(shell));
checkTrue('the drawer toggle reports its state', /aria-expanded=\{drawerOpen\}/.test(shell));
checkTrue('and what it controls', /aria-controls=\{drawerId\}/.test(shell));
checkTrue('the open section is marked for a screen reader', /aria-current=/.test(shell));
checkTrue('Escape closes the drawer', /key === 'Escape'/.test(shell));
checkTrue('focus returns to the toggle on close', /menuButtonRef\.current\?\.focus\(\)/.test(shell));

/*
 * DECORATIVE GRAPHICS MUST NOT BE ANNOUNCED. Every inline SVG in this console is
 * decorative — the control it sits in always carries its own text.
 */
{
  const withSvg = ['AdminShell.tsx'].map((n) =>
    readFileSync(join(import.meta.dirname, '..', 'src', 'components', n), 'utf8'),
  );
  withSvg.push(readScreen('OrganizationAudit.tsx'));
  let svgCount = 0;
  let hiddenCount = 0;
  for (const source of withSvg) {
    for (const tag of source.matchAll(/<svg[\s\S]*?>/g)) {
      svgCount += 1;
      if (/aria-hidden="true"/.test(tag[0])) hiddenCount += 1;
    }
  }
  check(`all ${String(svgCount)} inline SVGs are aria-hidden`, hiddenCount, svgCount);
}

/*
 * THE SPINNER IS DECORATIVE TOO — `busy` already changes the button's text, so
 * announcing the spinner would repeat it.
 */
checkTrue('the button spinner is aria-hidden', /aria-hidden="true"[\s\S]{0,120}animate-spin/.test(strip(buttonSource)));

console.log('\n=== Every form control has a programmatic label ===\n');

/*
 * `Field` wires `<label for>`, `aria-describedby` and `aria-invalid` together,
 * so a control rendered through it cannot be unlabelled. The check is that
 * nothing bypasses it.
 */
const fieldSource = strip(
  readFileSync(join(import.meta.dirname, '..', 'src', 'components', 'ui', 'field.tsx'), 'utf8'),
);
checkTrue('Field renders a real <label for>', /<label\s+htmlFor=\{id\}/.test(fieldSource));
checkTrue('Field joins hint and error into aria-describedby', /aria-describedby/.test(fieldSource));
checkTrue('Field sets aria-invalid only when there is an error', /'aria-invalid':\s*error\s*\?/.test(fieldSource));

for (const name of ['SignIn.tsx', 'Templates.tsx', 'PlatformAudit.tsx', 'OrganizationAudit.tsx', 'ResetCredential.tsx']) {
  const source = strip(readScreen(name));
  const inputs = (source.match(/<Input\b/g) ?? []).length;
  const selects = (source.match(/<select\b/g) ?? []).length;
  const fields = (source.match(/<Field\b/g) ?? []).length;
  if (inputs + selects === 0) {
    console.log(`PASS  ${name}: no bare form controls`);
    continue;
  }
  checkTrue(
    `${name}: ${String(inputs + selects)} control(s) are wrapped by ${String(fields)} Field(s)`,
    fields >= inputs + selects,
  );
}

/* =========================================================================
   13. THE BOUNDED TIME WINDOW — platform-audit-read-v1, amended
   ========================================================================= */

console.log('\n=== When a window is required, per feed ===\n');

check('the maximum span is 31 days', MAX_WINDOW_DAYS, 31);

/*
 * THE TWO FEEDS DIFFER. Platform: required when actor OR action is filtered.
 * Organization: required when action is filtered; `organization_id` is EXEMPT
 * because it is a path parameter served by an index.
 */
check('no filters -> no window required', windowIsRequired({}), false);
checkTrue('an actor filter requires one', windowIsRequired({ actorPrincipalId: 'pr_a' }));
checkTrue('an action filter requires one', windowIsRequired({ actionId: 'platform.audit.list' }));
checkTrue('both together require one', windowIsRequired({ actorPrincipalId: 'a', actionId: 'b' }));
check('an empty-string filter does not count as present', windowIsRequired({ actorPrincipalId: '', actionId: '' }), false);

console.log('\n=== The local pre-check mirrors the three refusals ===\n');

const W = (since, until) => ({ since, until });

check('an unfiltered query needs no window', windowRefusal(W('', ''), false), null);
checkTrue(
  'HALF a window is refused even unfiltered — it is an unbounded walk one way',
  windowRefusal(W('2026-09-01', ''), false) !== null,
);
checkTrue('a filtered query with no window is refused', windowRefusal(W('', ''), true) !== null);
checkTrue('a filtered query with only a start is refused', windowRefusal(W('2026-09-01', ''), true) !== null);
checkTrue('a filtered query with only an end is refused', windowRefusal(W('', '2026-09-30'), true) !== null);
check('a one-day window is accepted', windowRefusal(W('2026-09-05', '2026-09-05'), true), null);
check('exactly 31 days is accepted', windowRefusal(W('2026-09-01', '2026-10-01'), true), null);
checkTrue('32 days is refused', windowRefusal(W('2026-09-01', '2026-10-02'), true) !== null);
checkTrue('an inverted window is refused', windowRefusal(W('2026-09-30', '2026-09-01'), true) !== null);

/* THE BOUNDARY, ASSERTED RATHER THAN A VALUE IN THE MIDDLE. */
check('span of a single day is 1', spanInDays(W('2026-09-05', '2026-09-05')), 1);
check('span of 1 Sep to 1 Oct is 31', spanInDays(W('2026-09-01', '2026-10-01')), 31);
check('span of 1 Sep to 2 Oct is 32', spanInDays(W('2026-09-01', '2026-10-02')), 32);
checkTrue('an inverted span is not positive', (spanInDays(W('2026-09-30', '2026-09-01')) ?? 0) <= 0);

/*
 * THE REFUSAL NAMES THE LIMIT. Safe because a span limit is a CONSTANT, not a
 * fact about data — it discloses nothing about any record, operator or
 * Organization, which is why this contract may name it while collapsing its
 * cursor rejections.
 */
checkTrue(
  'the too-wide refusal names the 31-day limit',
  (windowRefusal(W('2026-09-01', '2026-12-01'), true) ?? '').includes('31'),
);

console.log('\n=== The three server tokens stay distinct ===\n');

const tokenError = (issue) =>
  new ApiError({ code: 'invalid_argument', details: [{ field: 'since', issue }] });

const messages = new Set();
for (const token of ['time_window_required', 'time_window_too_wide', 'time_window_inverted']) {
  check(`${token} is recognised`, windowRefusalToken(tokenError(token)), token);
  const described = describeWindowRefusal(token);
  checkTrue(`${token} has its own title`, described.title.length > 0);
  messages.add(described.title);
}
check('the three titles are all different', messages.size, 3);
check(
  'an unrelated invalid_argument is not treated as a window problem',
  windowRefusalToken(tokenError('must_be_an_identifier')),
  null,
);

console.log('\n=== Walking backwards: the window shift ===\n');

/*
 * IT SHIFTS BY THE WINDOW'S OWN LENGTH, NOT BY A CALENDAR MONTH, and the first
 * version did the latter and produced INVALID windows: `1 Sep – 1 Oct` is 31
 * days, and one calendar month earlier is `1 Aug – 1 Sep`, which is 32 — over
 * the limit and refused by Core, reached by pressing a button this console
 * offered. Months are not a fixed length; a span limit is.
 *
 * Caught by the check below, which is why it asserts the SPAN of the result
 * rather than its dates.
 */
check(
  'shifting earlier moves both ends by the span',
  JSON.stringify(shiftWindowByOwnLength(W('2026-09-01', '2026-09-30'), -1)),
  JSON.stringify(W('2026-08-02', '2026-08-31')),
);
check(
  'and shifting later returns to where it started',
  JSON.stringify(shiftWindowByOwnLength(shiftWindowByOwnLength(W('2026-09-01', '2026-09-30'), -1), 1)),
  JSON.stringify(W('2026-09-01', '2026-09-30')),
);
check('an empty draft shifts to nothing', shiftWindowByOwnLength(W('', ''), -1).since, '');
check(
  'an inverted draft is returned untouched rather than shifted into nonsense',
  JSON.stringify(shiftWindowByOwnLength(W('2026-09-30', '2026-09-01'), -1)),
  JSON.stringify(W('2026-09-30', '2026-09-01')),
);

/*
 * THE TWO PROPERTIES THAT MAKE IT USABLE FOR AN INVESTIGATION.
 */
for (const [since, until] of [
  ['2026-09-01', '2026-10-01'],
  ['2026-01-15', '2026-02-14'],
  ['2028-02-01', '2028-02-29'],
  ['2026-09-05', '2026-09-05'],
]) {
  const original = W(since, until);
  const shifted = shiftWindowByOwnLength(original, -1);
  const originalSpan = spanInDays(original);
  const shiftedSpan = spanInDays(shifted);
  check(`${since}..${until}: the span is preserved`, shiftedSpan, originalSpan);
  checkTrue(
    `${since}..${until}: the shifted window is still legal`,
    shiftedSpan !== null && shiftedSpan >= 1 && shiftedSpan <= MAX_WINDOW_DAYS,
  );
  /*
   * CONTIGUOUS, NOT OVERLAPPING. The earlier window must end exactly one day
   * before this one starts — a gap would hide records while looking exhaustive,
   * and an overlap would double-count them.
   */
  const gapDays =
    (new Date(`${original.since}T00:00:00.000Z`).getTime() -
      new Date(`${shifted.until}T00:00:00.000Z`).getTime()) /
    86_400_000;
  check(`${since}..${until}: windows tile with no gap and no overlap`, gapDays, 1);
}

console.log('\n=== The obligation a contract cannot enforce ===\n');

/*
 * *** A CONSOLE MUST RENDER AN EMPTY WINDOWED RESULT AS "NO RECORDS IN THIS
 * WINDOW", NEVER AS "NO RECORDS". ***
 *
 * Core refuses an omitted window so an operator cannot be silently narrowed.
 * Nothing stops them MISREADING a correctly narrow one — and an investigator who
 * filters by an operator, sees an empty page and concludes "this person did
 * nothing" has drawn a conclusion the data does not support. On an evidence
 * surface that is indistinguishable from evidence of innocence.
 *
 * ASSERTED IN THE SOURCE because it is the one requirement here with no
 * server-side enforcement at all.
 */
for (const name of ['PlatformAudit.tsx', 'OrganizationAudit.tsx']) {
  const source = readScreen(name);
  /*
   * WHITESPACE IS COLLAPSED BEFORE MATCHING PROSE. JSX wraps text at arbitrary
   * points, so "were not searched" can arrive as "were not\n  searched" — which
   * is what made the first version of this check report a false failure against
   * a screen that said exactly the right thing. Any multi-word assertion about
   * rendered prose has to normalise first.
   */
  const prose = source.replace(/\s+/g, ' ');
  checkTrue(
    `${name}: the empty state names the window it searched`,
    /No records in this window\./.test(prose),
  );
  checkTrue(
    `${name}: and states that outside it was not searched`,
    /were not searched/.test(prose),
  );
  checkTrue(
    `${name}: the window is chosen by whether one was APPLIED, not by whether filters were set`,
    /appliedWindow !== null\s*\?\s*'No records in this window\.'/.test(strip(source)),
  );
}

/* NO PREFETCH. Every window is 2 control-plane row-writes on a 600/day ceiling. */
for (const name of ['PlatformAudit.tsx', 'OrganizationAudit.tsx']) {
  const source = strip(readScreen(name));
  check(
    `${name}: the shift fires no request`,
    /shiftWindow[\s\S]{0,300}(setNonce|listPlatformAudit|listOrganizationAudit)/.test(source),
    false,
  );
}

/*
 * ===========================================================================
 * NO SENTENCE MAY PROMISE THE CONTROL MOVES BY A MONTH
 * ===========================================================================
 *
 * The shift was a calendar-month shift, and changing it to shift by the
 * window's own length TURNED NOTHING RED — while leaving two sentences behind
 * that still described the old behaviour: the too-wide refusal said the
 * controls "move the range by a month", and the empty state said "Move the
 * range back a month to keep looking." Both were found by reading, not by a
 * check, which is `workflow.md` §12 exactly: the code moved and the assertions
 * about it did not.
 *
 * A MONTH-PROMISE IS WRONG FOR ANY WINDOW THAT IS NOT A MONTH LONG, and an
 * operator investigating in fortnights would be told the button does something
 * it does not. Advice to SEARCH a month at a time is still true and is not what
 * this matches — only a claim about what the control MOVES.
 */
const monthPromise = /\b(move|moves|moving|shift|shifts|shifting)\b[^.]{0,80}\b(a|one) (calendar )?month\b/i;

for (const [label, prose] of [
  ['PlatformAudit.tsx', strip(readScreen('PlatformAudit.tsx'))],
  ['OrganizationAudit.tsx', strip(readScreen('OrganizationAudit.tsx'))],
  [
    'audit-window.ts',
    strip(readFileSync(join(import.meta.dirname, '..', 'src', 'api', 'audit-window.ts'), 'utf8')),
  ],
]) {
  check(
    `${label}: no sentence claims the control moves by a month`,
    monthPromise.test(prose.replace(/\s+/g, ' ')),
    false,
  );
}

/* THE KNOWN-FAILING INPUT: the exact sentence that was shipped and was wrong. */
checkTrue(
  'NEGATIVE CONTROL: the month-promise detector catches the sentence that was actually there',
  monthPromise.test('Move the range back a month to keep looking.'),
);
checkTrue(
  'NEGATIVE CONTROL: and the other one',
  monthPromise.test('the controls below move the range by a month without retyping it'),
);
check(
  'NEGATIVE CONTROL: advice to SEARCH a month at a time is not a month-promise',
  monthPromise.test('Search a month at a time and walk backwards.'),
  false,
);

/* =========================================================================
   14. THE TRANSCRIBED CONSTANT, ASSERTED AGAINST THE CONTRACT FILE
   ========================================================================= */

/*
 * ===========================================================================
 * WHY: `MAX_WINDOW_DAYS = 31` IS A NUMBER COPIED OUT OF A DOCUMENT
 * ===========================================================================
 *
 * The 31-day span limit now exists in at least three places — this contract,
 * Core's validator, and `audit-window.ts`'s constant — and until this section
 * existed, NOTHING COMPARED THEM. If the limit narrows to 14, this console goes
 * on refusing at 31 and an operator meets Core's refusal for a request the
 * screen said was fine. That is the permission-catalog transcription problem in
 * a new place.
 *
 * WHAT THIS CLOSES AND WHAT IT DOES NOT. It binds the console's constant to the
 * CONTRACT. It does NOT bind either to Core's validator — if Core's code and
 * Core's contract disagree, every check below stays green. The remaining gap is
 * real and is narrower than the one before it.
 *
 * IT READS THE CONTRACT, WHICH IS READ-ONLY TO THIS AGENT. Nothing here writes,
 * and the contract is the source of truth by construction.
 *
 * THE ANCHORS ARE FOUR INDEPENDENT SENTENCES, on purpose. A single anchor could
 * be deleted by a rewrite and the check would go quiet; four have to be edited
 * together, and the floor below turns a MISSING anchor red rather than absent.
 */

console.log('\n=== The 31-day constant, checked against the contract ===\n');

const AUDIT_CONTRACT_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'contracts',
  'core',
  'platform',
  'platform-audit-read-v1.contract.yaml',
);

/*
 * The contract states the limit ONCE IN WORDS AND THREE TIMES IN DIGITS. The
 * spelled form is in the most normative sentence of the section — the ruling —
 * and it carries no digit at all, so a digits-only check would not read it.
 */
const SPELLED_UNITS = [
  '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN',
  'EIGHTEEN', 'NINETEEN',
];
const SPELLED_TENS = [
  '', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY',
];

function spellDays(days) {
  if (!Number.isInteger(days) || days < 1 || days > 99) return null;
  if (days < 20) return SPELLED_UNITS[days];
  const tens = SPELLED_TENS[Math.floor(days / 10)];
  const unit = days % 10;
  return unit === 0 ? tens : `${tens}-${SPELLED_UNITS[unit]}`;
}

check('spellDays(31)', spellDays(31), 'THIRTY-ONE');
check('spellDays(14)', spellDays(14), 'FOURTEEN');
check('spellDays(7)', spellDays(7), 'SEVEN');
check('spellDays(90)', spellDays(90), 'NINETY');
check('spellDays refuses 0', spellDays(0), null);
check('spellDays refuses 100', spellDays(100), null);

function contractAnchors(maxDays) {
  const max = String(maxDays);
  const overMax = String(maxDays + 1);
  return [
    {
      name: 'the ruling — "the span must not exceed THIRTY-ONE DAYS"',
      pattern: /span must not exceed ([A-Z]+(?:-[A-Z]+)?) DAYS/,
      expect: [spellDays(maxDays)],
    },
    {
      name: 'the refusal rule — "A span exceeding 31 days is `invalid_argument`"',
      pattern: /A span exceeding (\d+) days is `invalid_argument`/,
      expect: [max],
    },
    {
      name: 'the request spec — "SPAN AT MOST 31 DAYS"',
      pattern: /SPAN AT MOST (\d+) DAYS/,
      expect: [max],
    },
    {
      name: 'the QA boundary — "32 days is refused; 31 days exactly is accepted"',
      pattern:
        /A span of (\d+) days is refused with `time_window_too_wide`; (\d+) days exactly is accepted/,
      expect: [overMax, max],
    },
  ];
}

/** `ok`, `mismatch` (the sentence is there and disagrees), or `missing`. */
function evaluateContract(text, maxDays) {
  return contractAnchors(maxDays).map((anchor) => {
    const found = anchor.pattern.exec(text);
    if (found === null) return { name: anchor.name, status: 'missing', found: null };
    const captured = found.slice(1);
    const agrees =
      captured.length === anchor.expect.length &&
      captured.every((value, index) => value === anchor.expect[index]);
    return { name: anchor.name, status: agrees ? 'ok' : 'mismatch', found: captured.join(', ') };
  });
}

let auditContractText = null;
try {
  auditContractText = readFileSync(AUDIT_CONTRACT_PATH, 'utf8');
} catch {
  auditContractText = null;
}
checkTrue(
  'the contract is readable at the path this check assumes',
  auditContractText !== null && auditContractText.length > 0,
);

const contractResults = evaluateContract(auditContractText ?? '', MAX_WINDOW_DAYS);
for (const result of contractResults) {
  check(
    `contract agrees with MAX_WINDOW_DAYS: ${result.name}`,
    result.status === 'ok' ? 'ok' : `${result.status}: ${String(result.found)}`,
    'ok',
  );
}

/*
 * THE FLOOR. "No findings" must not render as "no input" — an anchor set that
 * matches nothing would otherwise report four silent passes, which is the most
 * confident wrong answer a check can give.
 */
check(
  'all four statements of the limit were FOUND, not merely not-contradicted',
  contractResults.filter((result) => result.status !== 'missing').length,
  4,
);

/*
 * ===========================================================================
 * NEGATIVE CONTROLS — the known-failing inputs, without which this is observed
 * rather than verified
 * ===========================================================================
 */

/* 1. The drift this exists to catch: the console's constant narrowed to 14. */
const driftedResults = evaluateContract(auditContractText ?? '', 14);
check(
  'NEGATIVE CONTROL: a console constant of 14 is caught by all four anchors',
  driftedResults.filter((result) => result.status === 'mismatch').length,
  4,
);
check(
  'NEGATIVE CONTROL: and none of them passes',
  driftedResults.filter((result) => result.status === 'ok').length,
  0,
);

/* 2. Handed nothing, it must fail LOUDLY rather than find nothing wrong. */
const emptyResults = evaluateContract('', MAX_WINDOW_DAYS);
check(
  'NEGATIVE CONTROL: an empty contract reports four MISSING',
  emptyResults.filter((result) => result.status === 'missing').length,
  4,
);
check(
  'NEGATIVE CONTROL: and reports nothing as ok',
  emptyResults.filter((result) => result.status === 'ok').length,
  0,
);

/*
 * 3. The boundary is asserted as MAX + 1, not merely captured. Without this,
 *    the QA anchor would pass against a contract that had moved the refused
 *    span while leaving the accepted one alone.
 */
const movedBoundary = (auditContractText ?? '').replace(
  'A span of 32 days is refused',
  'A span of 33 days is refused',
);
checkTrue(
  'NEGATIVE CONTROL: the boundary mutation actually applied (a no-op control controls nothing)',
  auditContractText !== null && movedBoundary !== auditContractText,
);
check(
  'NEGATIVE CONTROL: a contract refusing at 33 rather than 32 goes red',
  evaluateContract(movedBoundary, MAX_WINDOW_DAYS)[3].status,
  'mismatch',
);

/* =========================================================================
   15. ORGANIZATION IDENTITY — organization-identity-v1
   ========================================================================= */

console.log('\n=== The three registration states stay three ===\n');

/*
 * THE STATE THAT MUST NOT COLLAPSE. `not_recorded` and `not_registered` are
 * different facts — "we never asked" versus "they told us they have none" —
 * and merging them destroys the ability to decide whether to prompt, and to
 * defend the record afterwards.
 */
const NOT_RECORDED = { state: 'not_recorded' };
const NOT_REGISTERED = { state: 'not_registered', declared_at: '2026-09-07T09:00:00.000Z' };
const REGISTERED_UNVERIFIED = {
  state: 'registered',
  number: 'CR-1234567',
  recorded_at: '2026-09-07T09:00:00.000Z',
  verification: null,
};
const REGISTERED_VERIFIED = {
  ...REGISTERED_UNVERIFIED,
  verification: {
    verified_by_principal_id: 'pr_synthetic_00000001',
    verified_at: '2026-09-07T09:30:00.000Z',
  },
};

check('not_recorded parses', parseRegistrationRecord(NOT_RECORDED, 'x').state, 'not_recorded');

const declared = parseRegistrationRecord(NOT_REGISTERED, 'x');
check('not_registered parses', declared.state, 'not_registered');
check(
  'and carries declared_at, which is what separates it from not_recorded',
  declared.state === 'not_registered' ? declared.declared_at : null,
  '2026-09-07T09:00:00.000Z',
);
checkTrue(
  'a not_registered WITHOUT declared_at is REFUSED, not read as an undated declaration',
  (() => {
    try {
      parseRegistrationRecord({ state: 'not_registered' }, 'x');
      return false;
    } catch {
      return true;
    }
  })(),
);

const unverified = parseRegistrationRecord(REGISTERED_UNVERIFIED, 'x');
check('registered parses', unverified.state, 'registered');
check(
  'a null verification stays NULL — recorded but unchecked is its own state',
  unverified.state === 'registered' ? unverified.verification : 'wrong',
  null,
);

const verified = parseRegistrationRecord(REGISTERED_VERIFIED, 'x');
check(
  'a verification carries WHO',
  verified.state === 'registered' ? verified.verification?.verified_by_principal_id : null,
  'pr_synthetic_00000001',
);
check(
  'and WHEN',
  verified.state === 'registered' ? verified.verification?.verified_at : null,
  '2026-09-07T09:30:00.000Z',
);

/*
 * `verification` IS REQUIRED AND NULLABLE, NOT OPTIONAL. An absent key is a
 * contract violation and is refused rather than read as null, because "recorded
 * but unverified" and "this response is not the shape it claims" are different
 * facts and only one of them is safe to render.
 */
checkTrue(
  'a registered record with NO verification key is refused, not defaulted to null',
  (() => {
    try {
      parseRegistrationRecord(
        { state: 'registered', number: 'X1', recorded_at: '2026-09-07T09:00:00.000Z' },
        'x',
      );
      return false;
    } catch {
      return true;
    }
  })(),
);

/*
 * AN UNKNOWN STATE IS CARRIED, NOT MAPPED ONTO `not_recorded`. Telling an
 * operator nobody had asked, when the truth is that this build cannot read the
 * answer, is a false statement about a customer.
 */
const unknownState = parseRegistrationRecord({ state: 'provisional' }, 'x');
check('an unknown state is reported as unrecognised', unknownState.state, 'unrecognised');
check(
  'and keeps the raw value so it can be shown verbatim',
  unknownState.state === 'unrecognised' ? unknownState.raw : null,
  'provisional',
);
check('not_recorded is a known state', isKnownRegistrationState('not_recorded'), true);
check('an invented state is NOT claimed as known', isKnownRegistrationState('provisional'), false);

console.log('\n=== The identity block, and the detail response that embeds it ===\n');

const IDENTITY_BODY = {
  display_name: 'Al Noor Trading',
  commercial_registration: REGISTERED_VERIFIED,
  vat_registration: NOT_REGISTERED,
};

const identity = parseOrganizationIdentity(IDENTITY_BODY, 'x');
check('display_name is read', identity.display_name, 'Al Noor Trading');
check('a null display_name stays null', parseOrganizationIdentity({ ...IDENTITY_BODY, display_name: null }, 'x').display_name, null);
check('the CR is read', identity.commercial_registration.state, 'registered');
check('the VAT is read', identity.vat_registration.state, 'not_registered');
checkTrue(
  'an identity block missing a registration is REFUSED — both are required',
  (() => {
    try {
      parseOrganizationIdentity({ display_name: null, commercial_registration: NOT_RECORDED }, 'x');
      return false;
    } catch {
      return true;
    }
  })(),
);

const DETAIL_WITH_IDENTITY = {
  organization_id: 'og_synthetic_0000000001',
  status: 'active',
  created_at: '2026-09-01T00:00:00.000Z',
  display_name: 'Al Noor Trading',
  commercial_registration: REGISTERED_UNVERIFIED,
  vat_registration: NOT_RECORDED,
  template: null,
  member_count: 3,
};
const detailWithIdentity = parseOrganizationDetail(DETAIL_WITH_IDENTITY);
check('the detail response carries the name', detailWithIdentity.display_name, 'Al Noor Trading');
check('and the CR', detailWithIdentity.commercial_registration.state, 'registered');
check('and the VAT', detailWithIdentity.vat_registration.state, 'not_recorded');

console.log('\n=== Local shape refusals — every one is about what was just typed ===\n');

check('a plain name is accepted', displayNameRefusal('Al Noor Trading'), null);
checkTrue('an empty name is refused', displayNameRefusal('') !== null);
checkTrue('a padded name is refused, not trimmed', displayNameRefusal(' Al Noor ') !== null);
checkTrue('a trailing-space name is refused', displayNameRefusal('Al Noor ') !== null);
check('a name at the bound is accepted', displayNameRefusal('A'.repeat(MAX_DISPLAY_NAME_LENGTH)), null);
checkTrue(
  'one character over the bound is refused',
  displayNameRefusal('A'.repeat(MAX_DISPLAY_NAME_LENGTH + 1)) !== null,
);

check('a plain registration number is accepted', registrationNumberRefusal('1234567'), null);
check('interior spaces are accepted', registrationNumberRefusal('CR 123 456'), null);
check('interior hyphens are accepted', registrationNumberRefusal('CR-123-456'), null);
checkTrue('a leading space is refused', registrationNumberRefusal(' 123') !== null);
checkTrue('a trailing hyphen is refused', registrationNumberRefusal('123-') !== null);
checkTrue('an empty number is refused', registrationNumberRefusal('') !== null);
check(
  'a number at the bound is accepted',
  registrationNumberRefusal('1'.repeat(MAX_REGISTRATION_NUMBER_LENGTH)),
  null,
);
checkTrue(
  'one character over the bound is refused',
  registrationNumberRefusal('1'.repeat(MAX_REGISTRATION_NUMBER_LENGTH + 1)) !== null,
);

/*
 * *** THERE IS NO DIGIT COUNT, AND THE ABSENCE IS A RULING RATHER THAN AN
 * OMISSION. *** Bahrain VAT account numbers are widely reported as fifteen
 * digits; that figure comes from secondary sources and is deliberately NOT in
 * the pattern. A PATTERN IS A REFUSAL — an at-count pattern that is wrong
 * refuses a LEGAL registration, and the failure lands on a customer who cannot
 * be onboarded and an operator whose only remedy is to invent a value.
 *
 * THIS CHECK EXISTS TO FAIL IF SOMEBODY NARROWS IT. Narrowing is BREAKING under
 * API_STANDARD.md §6 and requires a decision record citing the issuing
 * authority by document and date; a console that narrowed it locally would
 * produce exactly that refusal with none of that record.
 */
for (const plausible of ['1', '12', '123456789012345', '1234567890123456', 'A1', 'GB-99-X']) {
  check(`no digit count is imposed: ${plausible} is accepted`, registrationNumberRefusal(plausible), null);
}

console.log('\n=== The update sends a DIFF, and never an empty body ===\n');

{
  const sent = [];
  const { impl, calls } = stubFetch(jsonResponse(IDENTITY_BODY));
  const client = createPlatformClient({ fetchImpl: impl });
  await client.updateOrganizationIdentity('og_synthetic_0000000001', {
    display_name: 'Al Noor Trading',
  });
  const request = calls[0];
  sent.push(request);
  check(
    'the path carries the Organization and ends in /identity',
    request.url,
    '/api/v1/platform/organizations/og_synthetic_0000000001/identity',
  );
  check('the method is PATCH', request.init.method, 'PATCH');
  check(
    'only the changed field is sent',
    Object.keys(JSON.parse(request.init.body)).join(','),
    'display_name',
  );
}

{
  const { impl } = stubFetch(jsonResponse(IDENTITY_BODY));
  const client = createPlatformClient({ fetchImpl: impl });
  const both = await (async () => {
    const { impl: impl2, calls } = stubFetch(jsonResponse(IDENTITY_BODY));
    const c2 = createPlatformClient({ fetchImpl: impl2 });
    await c2.updateOrganizationIdentity('og_a', {
      commercial_registration: { state: 'registered', number: 'CR1', verified: false },
      vat_registration: { state: 'not_registered' },
    });
    return JSON.parse(calls[0].init.body);
  })();
  check(
    'two registrations send exactly two fields',
    Object.keys(both).sort().join(','),
    'commercial_registration,vat_registration',
  );
  check('the registration input carries no server-stamped field', Object.keys(both.commercial_registration).sort().join(','), 'number,state,verified');
  check('and not_registered carries only its state', Object.keys(both.vat_registration).join(','), 'state');
  /* Keeps `client` referenced so the stub above is not mistaken for dead code. */
  checkTrue('the client exposes the update method', typeof client.updateOrganizationIdentity === 'function');
}

/*
 * AN EMPTY BODY IS NEVER SENT. `minProperties: 1` — "a no-op here still writes a
 * platform audit record and FIVE ROW-WRITES INTO THE CUSTOMER'S OWN DAILY
 * ALLOCATION, and a request that spends a customer's budget to change nothing is
 * a request that should not have been accepted." So this refuses locally rather
 * than earning the refusal, and the condition is about the SHAPE of the request
 * rather than any fact about data.
 */
{
  const { impl, calls } = stubFetch(jsonResponse(IDENTITY_BODY));
  const client = createPlatformClient({ fetchImpl: impl });
  await checkThrows(
    'an empty update is refused locally',
    () => client.updateOrganizationIdentity('og_a', {}),
    'invalid_argument',
  );
  check('and no request was made at all', calls.length, 0);
}

console.log('\n=== The bounds, asserted against the schema file ===\n');

/*
 * THE SAME TREATMENT `MAX_WINDOW_DAYS` GETS, FOR THE SAME REASON: a number
 * copied out of a document is a claim that was true when it was copied. Here the
 * source is JSON, so the anchors are property paths rather than sentences.
 *
 * IT READS THE `.schema.json` AND NOT THE `.contract.yaml`. The YAML was being
 * edited by another agent while this was written; the schema is committed and
 * clean, and the field shapes are what it carries.
 *
 * WHAT THIS DOES NOT CLOSE: it binds the console to the CONTRACT, not to Core's
 * validator. If Core's code and Core's contract disagree, these checks stay
 * green.
 */
const IDENTITY_SCHEMA_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'contracts',
  'core',
  'platform',
  'organization-identity-v1.schema.json',
);

let identitySchema = null;
try {
  identitySchema = JSON.parse(readFileSync(IDENTITY_SCHEMA_PATH, 'utf8'));
} catch {
  identitySchema = null;
}
checkTrue('the identity schema is readable at the path this check assumes', identitySchema !== null);

/**
 * Reads one constraint, distinguishing MISSING from a value.
 *
 * "No findings" must not render as "no input": a renamed `$defs` entry returns
 * the string `missing`, which fails loudly, rather than `undefined`, which
 * compares equal to nothing and would pass against a constant that was also
 * undefined.
 */
function schemaConstraint(defName, keyword) {
  const def = identitySchema?.$defs?.[defName];
  if (def === undefined) return `missing $defs.${defName}`;
  if (!(keyword in def)) return `missing $defs.${defName}.${keyword}`;
  return def[keyword];
}

check(
  'MAX_DISPLAY_NAME_LENGTH matches displayName.maxLength',
  schemaConstraint('displayName', 'maxLength'),
  MAX_DISPLAY_NAME_LENGTH,
);
check(
  'MAX_REGISTRATION_NUMBER_LENGTH matches registrationNumber.maxLength',
  schemaConstraint('registrationNumber', 'maxLength'),
  MAX_REGISTRATION_NUMBER_LENGTH,
);
check(
  'the registration-number pattern is the schema’s, character for character',
  schemaConstraint('registrationNumber', 'pattern'),
  '^[A-Za-z0-9]([A-Za-z0-9 -]*[A-Za-z0-9])?$',
);
check(
  'the display-name pattern is the schema’s, character for character',
  schemaConstraint('displayName', 'pattern'),
  '^[^\\s].*[^\\s]$|^[^\\s]$',
);
check('a display name of zero characters is refused by the schema too', schemaConstraint('displayName', 'minLength'), 1);

/*
 * THE THREE STATES ARE THE SCHEMA'S THREE, ENUMERATED FROM IT RATHER THAN
 * ASSERTED FROM MEMORY. A fourth arriving in the contract turns this red, which
 * is the signal to teach the console about it — rather than the console
 * silently rendering it as `unrecognised` forever.
 */
const schemaStates = (identitySchema?.$defs?.registrationRecord?.oneOf ?? []).map(
  (branch) => branch?.properties?.state?.const ?? 'missing',
);
check(
  'the record states are exactly the three this console knows',
  schemaStates.join(','),
  'not_recorded,not_registered,registered',
);
const schemaInputStates = (identitySchema?.$defs?.registrationInput?.oneOf ?? []).map(
  (branch) => branch?.properties?.state?.const ?? 'missing',
);
check(
  'and the INPUT states are the same three',
  schemaInputStates.join(','),
  'not_recorded,not_registered,registered',
);

/*
 * NO SERVER-STAMPED FIELD IS SENDABLE. `declared_at`, `recorded_at`,
 * `verified_by_principal_id` and `verified_at` are all set by Core — "provenance
 * a caller supplies is not provenance". This asserts the SCHEMA forbids them,
 * and the request-shape check above asserts this client does not send them.
 */
const inputProperties = new Set(
  (identitySchema?.$defs?.registrationInput?.oneOf ?? []).flatMap((branch) =>
    Object.keys(branch?.properties ?? {}),
  ),
);
for (const stamped of ['declared_at', 'recorded_at', 'verified_by_principal_id', 'verified_at']) {
  check(`the input shape has no ${stamped}`, inputProperties.has(stamped), false);
}
check(
  'the input properties are exactly state, number and verified',
  [...inputProperties].sort().join(','),
  'number,state,verified',
);

/*
 * NEGATIVE CONTROLS. Without a known-failing input this section is observed
 * rather than verified — and both of these would have gone green against a
 * broken reader.
 */
check(
  'NEGATIVE CONTROL: a renamed $defs entry reads as MISSING, not as undefined',
  schemaConstraint('displayNameXX', 'maxLength'),
  'missing $defs.displayNameXX',
);
check(
  'NEGATIVE CONTROL: an absent keyword reads as MISSING',
  schemaConstraint('displayName', 'maxItems'),
  'missing $defs.displayName.maxItems',
);
checkTrue(
  'NEGATIVE CONTROL: the bound check would fail against a wrong constant',
  schemaConstraint('displayName', 'maxLength') !== MAX_DISPLAY_NAME_LENGTH + 1,
);

console.log('\n=== display_name: no placeholder is ever invented ===\n');

/*
 * *** AN INVENTED NAME IS INDISTINGUISHABLE FROM A TYPED ONE, FOREVER. *** The
 * contract binds both clients: render `organization_id` verbatim when
 * `display_name` is null — "not a blank, not a dash, not 'Unnamed
 * Organization'." Two consoles inventing two different placeholders is the
 * divergence the one-contract rule exists to prevent.
 */
/*
 * COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A LOOPHOLE — IT IS THE POINT.
 * The check is about what is RENDERED. Every one of these files QUOTES the
 * prohibition in a comment ("not a blank, not a dash, not 'Unnamed
 * Organization'"), so a check over raw source fails against a file that is
 * correct precisely because it explains the rule. That happened on the first
 * run of this check, and reading the raw source is what made it a false
 * positive rather than a finding.
 */
for (const name of ['Organizations.tsx', 'OrganizationDetail.tsx', 'OnboardOrganization.tsx']) {
  const rendered = strip(readScreen(name)).replace(/\s+/g, ' ');
  for (const placeholder of ['Unnamed Organization', 'Unnamed business', 'No name)', '(unnamed']) {
    check(`${name}: never renders "${placeholder}"`, rendered.includes(placeholder), false);
  }
}

/*
 * THE NEGATIVE CONTROL FOR THE ABOVE, because a check that strips comments
 * could strip everything and then find nothing wrong with an empty string.
 * These assert the detector fires on the thing it is looking for and that the
 * stripped source is not empty.
 */
checkTrue(
  'NEGATIVE CONTROL: the placeholder detector fires on a screen that DOES invent one',
  strip('<p>Unnamed Organization</p>').replace(/\s+/g, ' ').includes('Unnamed Organization'),
);
for (const name of ['Organizations.tsx', 'OrganizationDetail.tsx', 'OnboardOrganization.tsx']) {
  checkTrue(
    `NEGATIVE CONTROL: ${name} still has renderable source after stripping comments`,
    strip(readScreen(name)).replace(/\s+/g, ' ').length > 500,
  );
}

const identityPanel = readFileSync(
  join(import.meta.dirname, '..', 'src', 'components', 'OrganizationIdentity.tsx'),
  'utf8',
);
/*
 * COMMENTS STRIPPED BEFORE EVERY ASSERTION BELOW, INCLUDING THE POSITIVE ONES.
 * This file explains each rule at length in prose, so a check over raw source
 * could be satisfied by a COMMENT DESCRIBING the sentence rather than by the
 * sentence being on screen — green because the code is well documented, not
 * because it is right. Whitespace is collapsed after, because JSX wraps text at
 * arbitrary points.
 */
const identityCode = strip(identityPanel);
const identityProse = identityCode.replace(/\s+/g, ' ');
checkTrue(
  'FLOOR: the identity panel has renderable source after stripping comments',
  identityProse.length > 2000,
);

checkTrue(
  'the identity panel renders the no-name case as a real state',
  /No name recorded\./.test(identityProse),
);
checkTrue(
  'and says it is normal rather than an error',
  /it is not an error and nothing is missing/.test(identityProse),
);

/*
 * *** THE VERIFICATION RECORD IS THE POINT, SO IT IS RENDERED. *** The whole
 * argument for this route not being confirmation-gated is that verification
 * acts at the point of harm instead. A screen that shows the number and hides
 * whether anyone checked it destroys that argument.
 */
checkTrue(
  'an unverified number is visibly unverified',
  /Not verified/.test(identityProse),
);
checkTrue(
  'and says nobody has confirmed it against the registry',
  /Nobody has confirmed it against/.test(identityProse),
);
checkTrue(
  'a verified number names WHO checked it',
  /verification\.verified_by_principal_id/.test(identityProse),
);
checkTrue('and WHEN', /verification\.verified_at/.test(identityProse));

/*
 * NOT CONFIRMATION-GATED, AND THE CONSOLE MUST NOT INVENT A GATE THE LADDER DID
 * NOT PUT THERE. The route is `sensitive`, not `critical`: making a VAT field
 * critical generalises to every field and the rung stops sorting anything.
 */
for (const symbol of ['requestConfirmation', 'ConfirmationGate', 'confirmation_id']) {
  check(`the identity panel does not reach for ${symbol}`, identityCode.includes(symbol), false);
}

/*
 * THE THREE STATES ARE DISTINCT ON SCREEN. `not_registered` is an ANSWER, not a
 * gap — Bahrain VAT registration is voluntary below a threshold — and a console
 * that rendered it as missing data would keep prompting a customer who has
 * already replied.
 */
checkTrue(
  'not_recorded says Dudo does not know, rather than that they have none',
  /This does not mean they have no .* — it means Dudo does not know/.test(identityProse),
);
checkTrue(
  'not_registered is rendered as an answer',
  /This is an answer, not a gap/.test(identityProse),
);
checkTrue(
  'and its date is Dudo’s record of the statement, not their circumstances',
  /it makes it stale/.test(identityProse),
);

/*
 * EDITING A NUMBER CLEARS ITS VERIFICATION, AND THE FORM SAYS SO BEFORE THE
 * PRESS. A box left ticked from the previous value is an operator claiming to
 * have checked a number they have just replaced — "worse than an unverified
 * number because it defends itself."
 */
checkTrue(
  'the form warns that changing the number clears the verification',
  /Changing the number clears the existing verification\./.test(identityProse),
);
checkTrue(
  'and the tick is actually withdrawn in code, not merely described',
  /verified: currentNumber !== null && value !== currentNumber \? false : draft\.verified/.test(
    identityCode.replace(/\s+/g, ' '),
  ),
);
checkTrue(
  'the verified control is worded as a first-person claim, not a status',
  /I have checked this number against/.test(identityProse),
);
checkTrue(
  'and says nothing checks it for the operator',
  /Nothing checks this for you\./.test(identityProse),
);

console.log('\n=== Onboarding: no field is offered that would be discarded ===\n');

const onboardSource = readScreen('OnboardOrganization.tsx');
const onboardCode = strip(onboardSource);

/*
 * THE CONTRACT HAS NO CR AND NO VAT AT ONBOARDING. `onboardOrganizationInput`
 * is `additionalProperties: false` over five fields, and every Organization
 * starts `not_recorded`. A form that collected them would be collecting values
 * it cannot send.
 */
for (const field of ['commercial_registration', 'vat_registration']) {
  check(`onboarding never sends ${field}`, onboardCode.includes(field), false);
}

/*
 * `display_name` IS OFFERED AND IS OPTIONAL. It was briefly unsendable —
 * `platform.organizations.create` declared four fields and `display_name` was
 * not among them, while `organization-onboarding-v1.schema.json` published it,
 * and the class refuses undeclared fields BEFORE AUTHENTICATION. Core landed
 * the field on 2026-09-07 and the divergence is closed.
 *
 * THE GATE THAT HELD IT SHUT IS DELETED RATHER THAN PINNED TO `true`, and so
 * are the checks that guarded it. A flag that can no longer move keeps an
 * unreachable branch alive, and the unreachable half here was a paragraph
 * telling operators the name is recorded elsewhere — which is now FALSE. Dead
 * prose in a client is a stale assertion waiting for somebody to re-enable it.
 */
checkTrue(
  'the name field is offered, and labelled optional',
  /label="Business name — optional"/.test(onboardCode),
);
check(
  'no gate remains that could hide it',
  /CONSOLE_MAY_SEND_DISPLAY_NAME/.test(onboardSource),
  false,
);
check(
  'and the paragraph saying the name is recorded elsewhere is gone with it',
  /The business is named on its own page, not here/.test(onboardSource.replace(/\s+/g, ' ')),
  false,
);

/*
 * THE CLIENT OMITS AN EMPTY NAME RATHER THAN SENDING `''`. "Absent" and
 * "present and empty" are different requests and `minLength: 1` accepts only
 * one of them — an empty string would turn a blank optional field into a
 * validation error.
 */
{
  const { impl, calls } = stubFetch(
    jsonResponse({
      organization_id: 'og_a',
      admin_principal_id: 'pr_a',
      workspace_id: 'ws_a',
      warnings: [],
    }),
  );
  const client = createPlatformClient({ fetchImpl: impl });
  await client.onboardOrganization({
    admin_identifier: 'admin@example.com',
    template_id: 'tp_a',
    derived_value: 'a'.repeat(43),
    display_name: '',
  });
  check(
    'an empty display_name is OMITTED, not sent as an empty string',
    Object.keys(JSON.parse(calls[0].init.body)).sort().join(','),
    'admin_identifier,derived_value,first_workspace_name,template_id',
  );
}

{
  const { impl, calls } = stubFetch(
    jsonResponse({
      organization_id: 'og_a',
      admin_principal_id: 'pr_a',
      workspace_id: 'ws_a',
      warnings: [],
    }),
  );
  const client = createPlatformClient({ fetchImpl: impl });
  await client.onboardOrganization({
    admin_identifier: 'admin@example.com',
    template_id: 'tp_a',
    derived_value: 'a'.repeat(43),
    display_name: 'Al Noor Trading',
  });
  const body = JSON.parse(calls[0].init.body);
  check('a typed display_name IS sent', body.display_name, 'Al Noor Trading');
  check(
    'and the workspace placeholder is still a separate field',
    body.first_workspace_name,
    DISCARDED_WORKSPACE_NAME_PLACEHOLDER,
  );
}

console.log('');
if (failures > 0) {
  console.error(`${String(failures)} check(s) FAILED.`);
  process.exit(1);
}
console.log('All checks passed.');
