/**
 * THE KNOWN-FAILING INPUT for `check:ui-purity`. It is not package source and is
 * never compiled, imported, bundled or shipped — it sits outside `src/`, which
 * is the only directory the barrel, the build and the checker's population look
 * at.
 *
 * ===========================================================================
 * DO NOT "FIX" THE IMPORTS BELOW. THEY ARE THE TEST.
 * ===========================================================================
 *
 * `workflow.md` §11a: a check that ships without an input it should fail on has
 * been OBSERVED, not verified — sound-by-design and sound-by-accident look
 * identical while passing. Two checks in this repository were green for a reason
 * nobody chose, and one of them was a security gap.
 *
 * So this file deliberately commits every violation the checker declares, and
 * `check-ui-purity.mjs` goes red if any rule FAILS to fire on it. Deleting an
 * import here silently disables the rule it covers — which is the failure the
 * fixture exists to make impossible.
 */

/* rule: escapes-package — a relative path reaching out of packages/ui/src */
import { CustomerList } from '../../../../platform/web/src/screens/CustomerList';
/* rule: undeclared-dependency — real package, deliberately not in package.json */
import { useForm } from 'react-hook-form';
/* rule: undeclared-dependency — a Node builtin has no place in a browser primitive */
import { readFileSync } from 'node:fs';
/* rule: route-tree */
import { Link } from '@tanstack/react-router';
/* rule: server-state */
import { useQuery } from '@tanstack/react-query';

export { CustomerList, useForm, readFileSync, Link, useQuery };
