/**
 * The transport interface — the seam between every screen and whatever is
 * answering.
 *
 * ===========================================================================
 * ⚠ THIS LIVED IN `fixture-transport.ts`, AND THAT IS WHY A PRODUCTION BUILD
 * CONTAINED THE FIXTURES
 * ===========================================================================
 *
 * `Transport` and `DudoAction` were declared inside the fixture module, so
 * **six modules imported the interface from the implementation they were
 * written to be independent of** — `client.ts`, `auth.ts`, `use-session.ts`,
 * `use-organization.ts`, and `http-transport.ts`, which is the transport that
 * replaces the fixture and was importing its type from it.
 *
 * Those were `import type`, so they were erased and cost no runtime edge. **The
 * harm was not the bytes — it was that the dependency looked normal.** With the
 * interface owned by the fixture, a value import from the same module reads as
 * one more of the same, and three of them accumulated: `clients.ts` pulling
 * `createFixtureTransport`, `main.tsx` pulling the fault switches, and `auth.ts`
 * and `organization.ts` pulling the fixture session flag.
 *
 * **Measured on a `VITE_DUDO_TRANSPORT=http` production build before this file
 * existed:** all three fixture Business identifiers and **thirty-five fixture
 * customer records** were in the shipped JavaScript. The ternary in `clients.ts`
 * chooses at RUN time; the bundler links at BUILD time, and a statically
 * imported module is in the artifact whichever way the ternary goes.
 *
 * **THE INTERFACE BELONGS TO NEITHER IMPLEMENTATION.** That is the whole content
 * of this file: it declares the shape, imports nothing that answers requests,
 * and gives the real transport somewhere to point that is not the fake one.
 *
 * `fixture-transport.ts` re-exports both names so nothing outside had to move in
 * the same change — see the note there for why the re-export is temporary and
 * what removes it.
 */

import type { CustomerAction } from '../contracts/customer-directory';
import type { CoreAction } from '../contracts/business-read';

/**
 * Every Action either transport can be asked to invoke.
 *
 * A union of the two contracts' own Action unions rather than a string: an
 * Action name that no contract declares does not compile, which is the property
 * that stops a screen inventing a route.
 */
export type DudoAction = CustomerAction | CoreAction;

/**
 * What a screen may ask of the outside world.
 *
 * **Deliberately two members.** A transport invokes an Action and says what it
 * is; it does not know about customers, Businesses, Organizations or sessions,
 * and nothing that decides an outcome belongs here. The HTTP transport and the
 * fixture transport are interchangeable precisely because this stays this small.
 *
 * `name` is not decoration — `AppShell` renders it, so a reviewer looking at a
 * screenshot can tell whether they are looking at real data.
 */
export interface Transport {
  readonly name: string;
  invoke(action: DudoAction, input?: Record<string, unknown>): Promise<unknown>;
}
