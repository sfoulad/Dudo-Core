/**
 * Verifies the login request this client actually sends.
 *
 *   npm run verify:auth
 *
 * THIS IS THE HIGHEST-RISK WIRE SHAPE IN THE SLICE. `platform/core/identity/
 * login.ts` declares exactly two fields and Core refuses any undeclared one with
 * `invalid_argument / unknown_field`, so a third field, a renamed field or a raw
 * password here breaks login entirely — and the raw-password case would breach
 * ADR 0015 §D's central promise rather than merely failing.
 *
 * WHAT IT ASSERTS:
 *   - the method, path and content type;
 *   - that the body has EXACTLY the keys `email` and `derived_key`;
 *   - that `email` is the NORMALISED address, not what was typed;
 *   - that `derived_key` is 43 base64url characters and IS NOT THE PASSWORD;
 *   - that `credentials: 'same-origin'` is set, without which the browser throws
 *     the `Set-Cookie` away and the login accomplishes nothing;
 *   - that `identity.login.start` is never called;
 *   - that 401 and 429 decode correctly, with the retry time surfaced.
 *
 * WHAT IT DOES NOT ASSERT: that Core accepts it. Nothing is deployed and no
 * end-to-end login has been performed.
 */

import {
  createHttpAuthClient,
  IDENTIFIER_FIELD,
  DERIVED_KEY_FIELD,
  SESSION_REVOKE_PATH,
  LOGIN_COMPLETE_PATH,
} from '../src/api/auth.ts';
import { ApiError, isRetryable } from '../src/api/errors.ts';

/*
 * The main-thread fallback in `kdf-client.ts` yields one animation frame before
 * blocking, so the screen can paint first. Node has no such API; this shim is
 * the harness supplying it, and it is why the fallback path — not the Worker
 * path — is what runs here. The Worker path is the one browsers take and is
 * exercised manually in the acceptance checklist.
 */
globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);

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

const PASSWORD = 'correct horse battery staple';

console.log('\n=== Field names, ratified in platform/core/identity/login.ts ===\n');
check('identifier field is "email"', IDENTIFIER_FIELD, 'email');
check('derived key field is "derived_key"', DERIVED_KEY_FIELD, 'derived_key');

console.log('\n=== The login request ===\n');

{
  const { calls, fetchImpl } = stub(
    () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const result = await auth.login('Sam.Tester@Example.COM', PASSWORD, () => {});

  check('exactly one request is made', calls.length, 1);
  check('method', calls[0].init.method, 'POST');
  check('path', calls[0].url, '/auth/login/complete');
  check('content type', calls[0].init.headers['content-type'], 'application/json');
  check('credentials mode keeps the Set-Cookie', calls[0].init.credentials, 'same-origin');
  check('cache is no-store', calls[0].init.cache, 'no-store');

  const body = JSON.parse(calls[0].init.body);
  check('body has exactly two keys', Object.keys(body).sort(), ['derived_key', 'email']);
  check('email is NORMALISED, not what was typed', body.email, 'sam.tester@example.com');
  check('derived_key is 43 characters', body.derived_key.length, 43);
  check('derived_key is base64url', /^[A-Za-z0-9_-]{43}$/.test(body.derived_key), true);

  // THE ONE THAT MATTERS MOST. ADR 0015 §D: the raw password never leaves the
  // browser, and a client posting it would be indistinguishable to the server.
  check('derived_key is NOT the password', body.derived_key === PASSWORD, false);
  check('the body does not contain the password anywhere', calls[0].init.body.includes(PASSWORD), false);
  check('no "password" field exists', 'password' in body, false);

  check('result reports the normalised email', result.email, 'sam.tester@example.com');
  check('result reports the derived key length', result.derivedKeyLength, 43);
}

console.log('\n=== identity.login.start is never called ===\n');

{
  const { calls, fetchImpl } = stub(
    () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  await auth.login('sam@example.com', PASSWORD, () => {});
  check(
    'no request touches /auth/login/start',
    calls.some((call) => String(call.url).includes('/auth/login/start')),
    false,
  );
}

console.log('\n=== Refusals ===\n');

{
  const { fetchImpl } = stub(
    () =>
      new Response(
        JSON.stringify({
          error: { code: 'unauthenticated', message: 'Not authenticated.', request_id: 'req_1' },
        }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const error = await auth.login('sam@example.com', PASSWORD, () => {}).then(
    () => null,
    (thrown) => thrown,
  );
  check('401 becomes an ApiError', error instanceof ApiError, true);
  check('401 code is unauthenticated', error.code, 'unauthenticated');
  check('request_id preserved for support', error.request_id, 'req_1');
}

{
  const { fetchImpl } = stub(
    () =>
      new Response(
        JSON.stringify({ error: { code: 'rate_limited', message: 'Slow down.', request_id: 'r' } }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '45' } },
      ),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const error = await auth.login('sam@example.com', PASSWORD, () => {}).then(
    () => null,
    (thrown) => thrown,
  );
  check('429 code', error.code, 'rate_limited');
  check('retry_after_seconds surfaced from the header', error.retry_after_seconds, 45);
}

{
  const { fetchImpl } = stub(() => {
    throw new TypeError('Failed to fetch');
  });
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const error = await auth.login('sam@example.com', PASSWORD, () => {}).then(
    () => null,
    (thrown) => thrown,
  );
  check('a network failure is unavailable', error.code, 'unavailable');
}

console.log('\n=== A refused identifier costs no derivation and no request ===\n');

{
  const { calls, fetchImpl } = stub(
    () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const error = await auth.login(' sam@example.com', PASSWORD, () => {}).then(
    () => null,
    (thrown) => thrown,
  );
  check('a leading space is refused locally', error?.name, 'CredentialDerivationError');
  check('nothing is sent', calls.length, 0);
}

console.log('\n=== Progress is reported ===\n');

{
  const updates = [];
  const { fetchImpl } = stub(
    () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  await auth.login('sam@example.com', PASSWORD, (update) => {
    updates.push(update);
  });
  check('progress was reported at least twice', updates.length >= 2, true);
  check('the final report is complete', updates[updates.length - 1].fraction, 1);
  check(
    'no report ever exceeds 1',
    updates.every((update) => update.fraction <= 1),
    true,
  );
  check(
    'the elapsed time is a real measurement',
    updates[updates.length - 1].elapsedMs > 0,
    true,
  );
}

console.log('\n=== Logout — POST /auth/session/revoke, no body (docs/decisions/0018) ===\n');

check('revoke path', SESSION_REVOKE_PATH, '/auth/session/revoke');
check('login path', LOGIN_COMPLETE_PATH, '/auth/login/complete');

{
  const { calls, fetchImpl } = stub(
    () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  await auth.logout();

  check('exactly one request', calls.length, 1);
  check('method', calls[0].init.method, 'POST');
  check('path', calls[0].url, '/auth/session/revoke');
  /*
   * `login.ts` declares `fields: []`, so parsePreAuthBody rejects EVERY field a
   * caller sends. In particular there is no `session_id` field and there must
   * never be one: a logout taking an identifier from the body would let any
   * unauthenticated caller delete any session it could name.
   */
  check('NO body is sent', calls[0].init.body, undefined);
  check('no content-type is set', calls[0].init.headers['content-type'], undefined);
  // Without this the browser does not attach the cookie and revocation finds
  // nothing to revoke — while still answering 200, because it is collapsed.
  check('the cookie is attached', calls[0].init.credentials, 'same-origin');
}

/*
 * `cleared` REPORTS WHETHER THE CREDENTIAL LEFT THE BROWSER, AND NOTHING MORE.
 *
 * 0018 §B makes `collapseTo: 'cleared'`, and `revokeHandler` returns `cleared`
 * on all six paths — including the one where the delete itself failed. So a
 * `200` always carries the constant clearing cookie, and a non-`200` never does.
 * `cleared` therefore means "the credential is gone from this browser" and MUST
 * NOT be read as "the session row was deleted"; that second fact is what the
 * collapsed response exists to withhold.
 */
{
  const { fetchImpl } = stub(
    () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const outcome = await auth.logout().then((value) => value, () => 'rejected');
  check('200 reports cleared', outcome, { cleared: true });
}

{
  // The request never arrived: nothing revoked, no clearing cookie, session
  // still live. It must NOT reject — there is one exit path and it always ends
  // signed out — but it must report the truth so the screen can say so.
  const { fetchImpl } = stub(() => {
    throw new TypeError('Failed to fetch');
  });
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const outcome = await auth.logout().then((value) => value, () => 'rejected');
  check('a network failure resolves, and reports NOT cleared', outcome, { cleared: false });
}

{
  // 429 from the 60/minute source limit: the fixed rate_limited envelope carries
  // no clearing cookie and nothing was revoked.
  const { fetchImpl } = stub(() => new Response('', { status: 429 }));
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const outcome = await auth.logout().then((value) => value, () => 'rejected');
  check('a rate-limited logout reports NOT cleared', outcome, { cleared: false });
}

{
  const { fetchImpl } = stub(() => new Response('', { status: 503 }));
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  const outcome = await auth.logout().then((value) => value, () => 'rejected');
  check('a 503 resolves and reports NOT cleared', outcome, { cleared: false });
}

{
  // THE BUDGET RULE. 0018: revocation is 3 row-writes and a login/logout cycle
  // is 6 — 500 cycles/day platform-wide, 100 per principal. One press, one
  // request; no retry, no follow-up probe, no re-login.
  const { calls, fetchImpl } = stub(
    () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
  );
  const auth = createHttpAuthClient({ fetchImpl, baseUrl: '' });
  await auth.logout();
  check('one logout costs exactly one request', calls.length, 1);
}

console.log('\n=== 401 means signed out, never retry (docs/decisions/0018) ===\n');

/*
 * The rule enforced where it is decided rather than remembered at each call
 * site. After a successful logout the browser keeps presenting a DEAD cookie for
 * up to 12 hours, so retrying with it can only fail again.
 */
check('unauthenticated is NOT retryable', isRetryable({ code: 'unauthenticated' }), false);
check('forbidden is NOT retryable', isRetryable({ code: 'forbidden' }), false);
check('unavailable IS retryable', isRetryable({ code: 'unavailable' }), true);
check('timeout IS retryable', isRetryable({ code: 'timeout' }), true);
check('rate_limited IS retryable', isRetryable({ code: 'rate_limited' }), true);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
