/**
 * The resolve hook itself. See `node-resolve-hooks.mjs` for why it exists.
 *
 * Two rules, matching `vite.config.ts` and `tsconfig.json`:
 *
 *   `@/x`  ->  <web>/src/x
 *   `./x`  ->  ./x.ts, when ./x has no extension and ./x.ts exists
 *
 * It never invents a module: if the `.ts` file is not on disk it defers to
 * Node's own resolver, so a genuinely missing import still fails loudly.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const SRC = resolvePath(import.meta.dirname, '..', 'src');

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = resolvePath(SRC, specifier.slice(2));
    const candidate = existsSync(`${target}.ts`) ? `${target}.ts` : target;
    return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }

  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : SRC;
    const candidate = `${resolvePath(parentPath, specifier)}.ts`;
    if (existsSync(candidate)) {
      return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }

  return nextResolve(specifier, context);
}
