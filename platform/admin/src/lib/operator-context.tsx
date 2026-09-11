/**
 * The signed-in operator's `whoami`, made reachable by the routed sections.
 *
 * ===========================================================================
 * WHY A CONTEXT EXISTS AT ALL, AND WHY IT IS NOT ROUTER CONTEXT
 * ===========================================================================
 *
 * `App.tsx` passed `whoami` down to `Operators` as a prop. Under the route tree
 * there is no parent that can pass anything, so it needs a channel — and there
 * were three candidates:
 *
 *   · **Call `useOperatorSession` again in the screen.** NO. The probe is
 *     `whoami`, and `whoami` WRITES A PLATFORM-OPERATOR AUDIT RECORD ON EVERY
 *     CALL. A second caller would write rows to the operator trail describing
 *     nothing an operator did.
 *   · **Router context.** Rejected on meaning rather than mechanics: router
 *     context is set when the router is created, and this value arrives
 *     asynchronously after a probe. More importantly it would put a PERMISSION
 *     LIST somewhere that reads as though routing consults it.
 *   · **A React context provided by the layout that already holds the session.**
 *     This.
 *
 * ===========================================================================
 * IT CARRIES NO AUTHORITY, AND THE DISTINCTION IS THE ONE `0010` §7 NAMES
 * ===========================================================================
 *
 * `whoami` reports a permission list. **Nothing may branch on that list to
 * permit anything.** The one consumer today uses it to mark which row in the
 * operator table is the signed-in operator — *"recognises themselves only by
 * matching against `whoami`"* — which is rendering, not deciding.
 *
 * > *"The console holds no permission logic. It may RENDER according to
 * > permissions Core reports; it may never DECIDE them."*
 *
 * Every call is authorised again in Core on its own, and a section is reachable
 * by typing its address whatever this context says. **If a future screen reads
 * this to decide whether to allow something, that is the defect, not a feature
 * of the context.**
 *
 * THE PROVIDER IS NOT OPTIONAL AND `useWhoami` THROWS RATHER THAN RETURNING
 * NULL. A screen rendering outside the operator state is a routing mistake, and
 * a `null` here would be checked at one call site and forgotten at the next —
 * `architecture.md` §3a's preference for an omission that cannot compile,
 * applied where the type system alone cannot reach.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { WhoamiOutput } from '@/api/platform';

const OperatorContext = createContext<WhoamiOutput | null>(null);

export function OperatorProvider({
  whoami,
  children,
}: {
  whoami: WhoamiOutput;
  children: ReactNode;
}) {
  return <OperatorContext.Provider value={whoami}>{children}</OperatorContext.Provider>;
}

export function useWhoami(): WhoamiOutput {
  const whoami = useContext(OperatorContext);
  if (whoami === null) {
    throw new Error(
      'useWhoami was called outside OperatorProvider. A routed section renders only in the ' +
        'operator session state, where whoami is non-null by construction — reaching this ' +
        'means a section was mounted outside the shell.',
    );
  }
  return whoami;
}
