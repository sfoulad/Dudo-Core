/**
 * Verifies what the HTTP transport actually puts on the wire, and how it decodes
 * an error envelope.
 *
 * It substitutes a stub `fetch` and asserts the METHOD, URL, HEADERS, BODY and
 * CREDENTIALS MODE of each request against the two contracts' `httpBinding`
 * blocks. No network, no server, no dependency.
 *
 *   npm run verify:transport
 *
 * WHAT THIS CATCHES THAT A TYPE CHECK CANNOT: a path parameter also sent in the
 * body (which Core rejects outright), a `credentials` mode that silently drops
 * the session cookie, a `retry_after_seconds` read from the wrong place, and any
 * drift between the transcribed routes and the contracts.
 *
 * WHAT IT DOES NOT CATCH, STATED PLAINLY: whether Core actually accepts these
 * requests. Nothing is deployed and nothing has been called end to end. This
 * verifies THIS CLIENT'S HALF of the binding and nothing about the other half.
 */

import { createHttpTransport } from '../src/api/http-transport.ts';
import { createCustomerDirectoryClient } from '../src/api/client.ts';
import { ApiError } from '../src/api/errors.ts';

let failures = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : `\n        expected ${e}\n        actual   ${a}`),
  );
}

/** A stub `fetch` that records the call and answers with a canned response. */
function stub(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return response(url, init);
  };
  return { calls, fetchImpl };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ok = (body) => () => jsonResponse(200, body);

console.log('\n=== Route binding: method and URL, per httpBinding ===\n');

{
  const { calls, fetchImpl } = stub(ok({ data: [], next_cursor: null }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.listCustomers({ status: 'archived', page_size: 25 });
  check('ListCustomers method', calls[0].init.method, 'GET');
  check(
    'ListCustomers URL carries filters as query',
    calls[0].url,
    '/api/v1/apps/customers/customers?status=archived&page_size=25',
  );
  check('GET sends no body', calls[0].init.body, undefined);
  check('credentials mode is same-origin', calls[0].init.credentials, 'same-origin');
  check('cache is no-store', calls[0].init.cache, 'no-store');
  check('redirects are not followed', calls[0].init.redirect, 'error');
}

{
  const { calls, fetchImpl } = stub(ok({ data: [], next_cursor: null }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.searchCustomers({ query: 'ali baker', status: 'all' });
  check(
    'SearchCustomers URL',
    calls[0].url,
    '/api/v1/apps/customers/customers/search?query=ali+baker&status=all',
  );
}

{
  const { calls, fetchImpl } = stub(ok({ customer_id: 'cus_1' }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.getCustomer('cus_abc123');
  check('GetCustomer URL interpolates the path parameter', calls[0].url, '/api/v1/apps/customers/customers/cus_abc123');
}

{
  const { calls, fetchImpl } = stub(ok({ customer_id: 'cus_1' }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.createCustomer({
    business_id: 'biz_one',
    display_name: 'Ali Baker',
    customer_type: 'person',
    email: 'ali@example.com',
  });
  check('CreateCustomer method', calls[0].init.method, 'POST');
  check('CreateCustomer URL', calls[0].url, '/api/v1/apps/customers/customers');
  check(
    'CreateCustomer body',
    JSON.parse(calls[0].init.body),
    {
      business_id: 'biz_one',
      display_name: 'Ali Baker',
      customer_type: 'person',
      email: 'ali@example.com',
    },
  );
  check('POST sets content-type', calls[0].init.headers['content-type'], 'application/json');
}

console.log('\n=== The rule Core enforces: a path parameter must NOT repeat in the body ===\n');

{
  /*
   * `mergeInputSources` in platform/core/http/router.ts returns `undefined` — and
   * the whole request is refused — when a key arrives from two sources. So
   * `customer_id` must appear in the PATH and nowhere else.
   */
  const { calls, fetchImpl } = stub(ok({ customer_id: 'cus_1' }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.updateCustomer('cus_abc123', { display_name: 'Ali B', email: null });
  check('UpdateCustomer method', calls[0].init.method, 'PATCH');
  check('UpdateCustomer URL', calls[0].url, '/api/v1/apps/customers/customers/cus_abc123');
  const body = JSON.parse(calls[0].init.body);
  check('UpdateCustomer body does NOT repeat customer_id', 'customer_id' in body, false);
  check('UpdateCustomer body carries the changes', body, { display_name: 'Ali B', email: null });
  // The three-way distinction: present-and-null means CLEAR, and must survive
  // serialisation as a real null rather than being dropped.
  check('an explicit null survives to the wire', body.email, null);
}

{
  const { calls, fetchImpl } = stub(ok({ customer_id: 'cus_1' }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.archiveCustomer('cus_abc123');
  check('ArchiveCustomer URL', calls[0].url, '/api/v1/apps/customers/customers/cus_abc123/archive');
  check('ArchiveCustomer sends NO body (Core reads empty as {})', calls[0].init.body, undefined);
}

{
  const { calls, fetchImpl } = stub(ok({ customer_id: 'cus_1' }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.moveCustomerToBusiness('cus_abc123', 'biz_two');
  check('Move URL', calls[0].url, '/api/v1/apps/customers/customers/cus_abc123/move');
  check('Move body carries only business_id', JSON.parse(calls[0].init.body), {
    business_id: 'biz_two',
  });
}

console.log('\n=== Business Read routes ===\n');

{
  const { calls, fetchImpl } = stub(ok({ data: [], next_cursor: null }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.listAuthorizedBusinesses();
  check('ListAuthorizedBusinesses URL', calls[0].url, '/api/v1/businesses?page_size=100');
}

{
  const { calls, fetchImpl } = stub(ok({ data: [] }));
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  await client.resolveBusinessReferences(['biz_one', 'biz_two']);
  /*
   * THE REVISED FORM. business-read-v1.contract.yaml was revised on 2026-09-04:
   * the batch was `GET ...?business_ids=a&business_ids=b`, which could never
   * succeed because platform/core/http/api.ts:253-266 rejects every repeated
   * query parameter. It is now a JSON body on a POST. The SHAPE did not change —
   * `business_ids` was always an array — only the carrier.
   */
  check('ResolveBusinessReferences method is POST', calls[0].init.method, 'POST');
  check('ResolveBusinessReferences URL carries no query', calls[0].url, '/api/v1/businesses/names');
  check('the batch travels as a JSON array in the body', JSON.parse(calls[0].init.body), {
    business_ids: ['biz_one', 'biz_two'],
  });
  /*
   * ORDER IS THE SECURITY PROPERTY, not an ergonomic one: the response carries
   * one entry per requested identifier AT THE SAME INDEX, so a client that let
   * the request order drift would misattribute names to Businesses.
   */
  check(
    'request order is preserved',
    JSON.parse(calls[0].init.body).business_ids,
    ['biz_one', 'biz_two'],
  );
}

{
  /*
   * A GET may no longer carry an array, and the client refuses locally rather
   * than emitting a repeated parameter Core would reject. This pins the guard so
   * that binding a future array-valued Action to GET fails at the call site.
   */
  const { calls, fetchImpl } = stub(ok({ data: [], next_cursor: null }));
  const transport = createHttpTransport({ fetchImpl, baseUrl: '' });
  const error = await transport
    .invoke('core.ListAuthorizedBusinesses', { page_size: 1, business_ids: ['a', 'b'] })
    .then(() => null, (thrown) => thrown);
  check('an array in a GET query is refused locally', error?.code, 'invalid_argument');
  check('and nothing is sent', calls.length, 0);
}

console.log('\n=== Error decoding ===\n');

{
  const { fetchImpl } = stub(() =>
    jsonResponse(429, {
      error: { code: 'rate_limited', message: 'Slow down.', request_id: 'req_abc' },
    }, { 'retry-after': '37' }),
  );
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  const error = await client.listCustomers().then(() => null, (thrown) => thrown);
  check('429 becomes an ApiError', error instanceof ApiError, true);
  check('rate_limited code', error.code, 'rate_limited');
  check('retry_after_seconds read from the Retry-After HEADER', error.retry_after_seconds, 37);
  check('request_id preserved', error.request_id, 'req_abc');
}

{
  // The envelope's own field wins when both are present: a body field is the
  // contract's, and the header is Core's transport hint for the same fact.
  const { fetchImpl } = stub(() =>
    jsonResponse(429, {
      error: {
        code: 'rate_limited',
        message: 'Slow down.',
        request_id: 'req_abc',
        retry_after_seconds: 12,
      },
    }, { 'retry-after': '37' }),
  );
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  const error = await client.listCustomers().then(() => null, (thrown) => thrown);
  check('body retry_after_seconds wins over the header', error.retry_after_seconds, 12);
}

{
  const { fetchImpl } = stub(() =>
    jsonResponse(400, {
      error: {
        code: 'invalid_argument',
        message: 'Bad field.',
        request_id: 'req_x',
        details: [{ field: 'display_name', issue: 'too_long' }],
      },
    }),
  );
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  const error = await client.listCustomers().then(() => null, (thrown) => thrown);
  check('details decoded', error.details, [{ field: 'display_name', issue: 'too_long' }]);
}

{
  let signalled = 0;
  const { fetchImpl } = stub(() =>
    jsonResponse(401, {
      error: { code: 'unauthenticated', message: 'Not authenticated.', request_id: 'req_y' },
    }),
  );
  const transport = createHttpTransport({
    fetchImpl,
    baseUrl: '',
    onUnauthenticated: () => {
      signalled += 1;
    },
  });
  const client = createCustomerDirectoryClient(transport);
  const error = await client.listCustomers().then(() => null, (thrown) => thrown);
  check('401 fires onUnauthenticated exactly once', signalled, 1);
  check('401 code', error.code, 'unauthenticated');
}

{
  // Something in front of the Worker answered with HTML. The status is the only
  // information available and must not be reported as a Dudo message.
  const { fetchImpl } = stub(
    () => new Response('<html>502</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
  );
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  const error = await client.listCustomers().then(() => null, (thrown) => thrown);
  check('502 with no envelope maps to unavailable', error.code, 'unavailable');
  check(
    '502 says the envelope was missing',
    error.message,
    'The server answered 502 without a Dudo error envelope.',
  );
}

{
  const { fetchImpl } = stub(() => {
    throw new TypeError('Failed to fetch');
  });
  const client = createCustomerDirectoryClient(createHttpTransport({ fetchImpl, baseUrl: '' }));
  const error = await client.listCustomers().then(() => null, (thrown) => thrown);
  check('a network failure is unavailable, not internal', error.code, 'unavailable');
}

{
  const { fetchImpl } = stub(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }),
  );
  const client = createCustomerDirectoryClient(
    createHttpTransport({ fetchImpl, baseUrl: '', timeoutMs: 30 }),
  );
  const error = await client.listCustomers().then(() => null, (thrown) => thrown);
  check('a timeout is reported as timeout', error.code, 'timeout');
}

console.log('\n=== Base URL ===\n');

{
  const { calls, fetchImpl } = stub(ok({ data: [], next_cursor: null }));
  const client = createCustomerDirectoryClient(
    createHttpTransport({ fetchImpl, baseUrl: 'https://dudo-test.example' }),
  );
  await client.listCustomers();
  check(
    'an explicit base URL is prefixed to the contract path',
    calls[0].url,
    'https://dudo-test.example/api/v1/apps/customers/customers',
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
