/**
 * What the fixture modules resolve to in a build that talks to Core.
 *
 * ===========================================================================
 * THE USER'S INSTRUCTION IS "NO FIXTURE FALLBACK IN THE DEPLOYED BUILD", AND
 * A RUNTIME TERNARY DOES NOT SATISFY IT
 * ===========================================================================
 *
 * `lib/clients.ts` has always chosen the transport with a ternary on
 * `CONFIG.transport`. **The ternary chooses at RUN time; the bundler links at
 * BUILD time** — so a statically imported module is in the artifact whichever
 * way the ternary goes, and *"it only activates when a flag is set"* is exactly
 * the shape that ships.
 *
 * **Measured on a `VITE_DUDO_TRANSPORT=http` production bundle before this file
 * existed:**
 *
 * ```
 * biz_marina_ops  biz_atlas_logi  biz_northgate1     3 fixture Businesses
 * cus_*                                             35 fixture customer records
 * ```
 *
 * **All of it shipped, in the build that talks to a real server.** Nothing was
 * misconfigured and no flag was wrong — the code was simply linked in.
 *
 * ===========================================================================
 * HOW THE ABSENCE IS ACHIEVED, AND WHY IT IS NOT A FLAG
 * ===========================================================================
 *
 * `vite.config.ts` carries a `resolveId` hook that redirects
 * `fixture-transport` and `fixture-session-state` to THIS module whenever the
 * build's transport is `http`. **The fixture modules are then not in the module
 * graph at all**, so neither they nor `fixtures.ts` — reachable only through
 * them — reach the artifact.
 *
 * **`tsc` never sees the redirect**, which is the property that makes this
 * cheap: type checking runs against the real modules, so every call site stays
 * fully checked and nothing is cast or widened to accommodate the swap.
 *
 * ===========================================================================
 * EVERY EXPORT THROWS, AND NOTHING SHOULD EVER CALL ONE
 * ===========================================================================
 *
 * All four call sites are already inside `CONFIG.transport !== 'http'`
 * branches, so in an http build none of these is reachable. **They throw rather
 * than returning something harmless** because the two failure modes are not
 * comparable: a throw is a crash on the first call, at the exact line, with the
 * reason in the message. **A silent no-op is a customer looking at a screen
 * that is quietly answering from nowhere** — and being unable to tell.
 *
 * `architecture.md` §3a's ranking, applied to a bundle: the strongest layer is
 * the one where the wrong thing cannot be present. This is that layer; the
 * throws are the backstop for a guard that is wrong.
 *
 * **The export list is kept honest by a check, not by care.**
 * `scripts/verify-bundle.mjs` compares these names against the value exports of
 * the two real modules and goes red on either a missing one — which would be a
 * broken http build — or a surplus one, which would be a name nobody imports.
 */

import type { Transport } from './transport';

const REASON =
  'The fixture transport is not present in this build. It is excluded at resolve time when ' +
  'VITE_DUDO_TRANSPORT=http (see vite.config.ts and src/api/fixture-absent.ts). Reaching this ' +
  'means a caller ran a fixture-only path in a build that talks to Core, which is a defect in ' +
  'the guard around that call rather than in this module.';

function absent(symbol: string): never {
  throw new Error(`${symbol}: ${REASON}`);
}

/* --- from `fixture-transport.ts` ------------------------------------------ */

export function createFixtureTransport(): Transport {
  return absent('createFixtureTransport');
}

export function configureFaults(_scope: string | null, _code?: string | null): void {
  absent('configureFaults');
}

export function configureBusinesses(_mode: string | null): void {
  absent('configureBusinesses');
}

/* --- from `fixture-session-state.ts` -------------------------------------- */

/**
 * ⚠ `fixtureOrganizationSelected` IS DELIBERATELY NOT HERE, AND THE CHECK IS
 * WHAT REMOVED IT.
 *
 * The first version of this file stubbed it alongside its setter, which reads
 * as obviously right — they are a pair. **`verify-bundle.mjs`'s surplus
 * assertion failed on its first run:** the only module that reads it is
 * `fixture-transport.ts`, **which is itself replaced by this file in an http
 * build**, so in the build where this module exists nothing calls it.
 *
 * A surplus export is not harmless. It reads as coverage, it is the shape a
 * future caller reaches for, and it makes the stub look like a mirror of the
 * fixture rather than what it is — **exactly the set of symbols the production
 * graph still names.**
 */
export function setFixtureOrganizationSelected(_value: boolean): void {
  absent('setFixtureOrganizationSelected');
}
