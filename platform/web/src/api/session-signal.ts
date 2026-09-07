/**
 * Two signals from the transport to the gates above the screens:
 * "Core just refused a request as unauthenticated", and "Core just refused one
 * as a failed precondition".
 *
 * WHY A MODULE-LEVEL EMITTER RATHER THAN A PROP. The transport is constructed
 * once, outside React, and every screen shares it; the component that needs to
 * react to a `401` is the auth gate, which is above the screens that make the
 * calls. Threading a callback down would mean rebuilding the transport whenever
 * the gate re-rendered, and a rebuilt transport is a new object identity that
 * re-triggers every `useEffect` keyed on the client.
 *
 * IT CARRIES NO PAYLOAD AND DECIDES NOTHING. The request was already refused by
 * Core, which is the only place that decision is made or counts
 * (`security.md` §2). This is a notification that lets the UI stop pretending
 * someone is signed in — presentation, not security.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function onUnauthenticated(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function signalUnauthenticated(): void {
  for (const listener of listeners) listener();
}

/* -------------------------------------------------------------------------
   "A precondition failed" — which is not the same as "choose an Organization"
   ------------------------------------------------------------------------- */

/**
 * The second signal, and it is deliberately vaguer than the first.
 *
 * A `401` means one thing. A `422` means one of two things that Core renders
 * identically — no Organization selected, or a record that is not in a state
 * permitting the operation — because `failedPrecondition()` takes no arguments
 * and returns a constant message. This signal therefore carries no claim about
 * which; the listener decides by probing, and until it has, nothing may be
 * drawn on the strength of this alone.
 *
 * IT FIRES ON EVERY 422 INCLUDING THE ORDINARY BUSINESS ONES, so a listener
 * must be idempotent and must not treat repeats as new information.
 */
const preconditionListeners = new Set<Listener>();

export function onPreconditionFailed(listener: Listener): () => void {
  preconditionListeners.add(listener);
  return () => {
    preconditionListeners.delete(listener);
  };
}

export function signalPreconditionFailed(): void {
  for (const listener of preconditionListeners) listener();
}
