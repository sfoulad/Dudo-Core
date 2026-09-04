/**
 * A Node ESM resolve hook so the verification scripts can import the real
 * application modules.
 *
 * WHY IT IS NEEDED. The application's imports are extensionless (`./errors`) and
 * aliased (`@/contracts/business-read`), which is what Vite resolves and what
 * `tsconfig.json` describes — and `allowImportingTsExtensions` is false, so
 * writing `./errors.ts` in the source is not an option either. Node's ESM
 * resolver requires a full specifier, so without this hook the scripts can only
 * import modules that import nothing.
 *
 * The alternative was to duplicate the transport in the script, which would let
 * the script pass while the shipped file was wrong — the exact failure that
 * makes a verification script worse than none.
 *
 * IT IS A DEV-ONLY, ZERO-DEPENDENCY FILE. `node:module` and `node:path` are
 * built in, nothing is installed, and nothing here is bundled or shipped: it is
 * loaded only by `npm run verify:transport`. It does not touch the Vite build,
 * the tsconfig, or any runtime code path.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./node-resolve-impl.mjs', pathToFileURL(`${import.meta.dirname}/`));
