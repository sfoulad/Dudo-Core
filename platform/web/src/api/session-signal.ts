/**
 * One signal: "Core just refused a request as unauthenticated."
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
