/**
 * A Node ESM resolve hook so the verification scripts can import the real
 * application modules.
 *
 * WHY IT IS NEEDED. The console's imports are extensionless (`./errors`) and
 * aliased (`@/api/platform`), which is what Vite resolves and what
 * `tsconfig.json` describes. Node's ESM resolver requires a full specifier, so
 * without this hook the scripts can only import modules that import nothing.
 * `verify-platform.mjs` imports plenty, so it needs this.
 *
 * ---------------------------------------------------------------------------
 * ⚠ TWO CORRECTIONS, 2026-09-09, AND THE SECOND IS THE ODD ONE
 * ---------------------------------------------------------------------------
 *
 * **1. This paragraph ended with an example that no longer exists:**
 * *"`verify-kdf.mjs` gets away without it because `kdf.ts` imports nothing."*
 * Both files left this tree for `@dudo/client-kdf` (ADR 0040). The *point* it
 * illustrated is still true — a script importing only leaf modules needs no
 * hook — so the point is kept and the vanished example is dropped.
 *
 * **2. IT ALSO SAID `allowImportingTsExtensions` IS FALSE. IT WAS TRUE.**
 * `tsconfig.json` carried `"allowImportingTsExtensions": true` from the day this
 * sentence was written until the option was removed as unused, hours before this
 * correction. **So the clause "writing `./errors.ts` in the source is not an
 * option either" rested on a premise that was false** — it was an option, and
 * nobody checked, because the sentence stated it flatly.
 *
 * **The removal made a wrong sentence right by accident, which is the worst way
 * for one to become true**: nothing in the tree ever went red, and had anyone
 * relied on it during that window they would have been reasoning from a
 * constraint the compiler was not enforcing. **A comment asserting the value of
 * a config field is a claim about that file** (`architecture.md` §3c), and this
 * one is now removed rather than corrected — the hook's justification does not
 * need it, and a restated config value is a second copy that can drift again.
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
