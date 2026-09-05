/**
 * A Node ESM resolve hook so the verification scripts can import the real
 * application modules.
 *
 * WHY IT IS NEEDED. The console's imports are extensionless (`./errors`) and
 * aliased (`@/api/platform`), which is what Vite resolves and what
 * `tsconfig.json` describes — and `allowImportingTsExtensions` is false, so
 * writing `./errors.ts` in the source is not an option either. Node's ESM
 * resolver requires a full specifier, so without this hook the scripts can only
 * import modules that import nothing. `verify-kdf.mjs` gets away without it
 * because `kdf.ts` imports nothing; `verify-platform.mjs` does not.
 *
 * The alternative was to duplicate the client in the script, which would let the
 * script pass while the shipped file was wrong — the exact failure that makes a
 * verification script worse than none.
 *
 * IT IS A DEV-ONLY, ZERO-DEPENDENCY FILE. `node:module` and `node:url` are built
 * in, nothing is installed, and nothing here is bundled or shipped. It does not
 * touch the Vite build, the tsconfig, or any runtime code path.
 *
 * THE SAME FILE EXISTS IN `platform/web/scripts/`. It is not under the KDF drift
 * check and does not need to be: it is build tooling, and the two consoles are
 * free to diverge here without anyone being unable to sign in.
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./node-resolve-impl.mjs', pathToFileURL(`${import.meta.dirname}/`));
