/**
 * The Organization-selection state machine.
 *
 * SOURCE: packages/contracts/core/identity/organization-selection-v1.contract.yaml
 *         — `clientObligations`, which is normative and is followed here literally.
 *
 * ===========================================================================
 * THE FLOW IS REACTIVE. THE CLIENT DOES NOT CALL THE PICKER AFTER LOGIN.
 * ===========================================================================
 *
 * The contract is emphatic and the reasoning is not obvious, so it is recorded
 * rather than trusted to memory:
 *
 *   1. Log in. A `200` is NOT a usable session and the body has no field that
 *      says whether one was selected. DO NOT BRANCH HERE.
 *   2. Make the ordinary request the person asked for.
 *   3. On `failed_precondition`: get the picker, select, and let the screen
 *      re-read.
 *
 * Calling the picker eagerly after every login "to find out what to select"
 * looks tidier and is wrong: it spends three point reads on every cold start,
 * and it tempts the client into re-selecting what is already selected — a
 * redundant call costing the full 3 row-writes, because the contract
 * deliberately has no already-selected short-circuit.
 *
 * IT IS ALSO THE SAME CODE FOR THE MID-SESSION CASE, which is the one clients
 * get wrong. Membership is re-validated on EVERY request, so a membership
 * revoked while someone is working collapses the session to unselected at the
 * NEXT request. That person must land back at the picker with an explanation —
 * not at a login screen, and not in a retry loop. Because this hook is driven
 * by the refusal rather than by the login, that case is not a special case.
 *
 * ===========================================================================
 * WHY A PROBE SITS BETWEEN THE SIGNAL AND THE PICKER
 * ===========================================================================
 *
 * The contract says a 422 from any route means "no Organization selected". THAT
 * IS NOT TRUE OF THE DEPLOYED PLATFORM and this hook must not act as though it
 * were: `customer-directory-v1` uses `failed_precondition` for its own state
 * machine — archiving an archived customer, editing a pending-deletion one —
 * and `kernel/errors.ts` renders both with the same constant message and no
 * details. The two are byte-identical.
 *
 * So a 422 opens nothing by itself. It triggers `probeSession`, which asks an
 * Action that has no business precondition of its own, and only that answer
 * opens the picker. The cost is one cheap read on a refusal that is rare
 * either way; the alternative is showing an Organization picker to somebody who
 * just tried to archive an archived customer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { probeSession } from '@/api/auth';
import { onPreconditionFailed } from '@/api/session-signal';
import { toApiError, type ApiError } from '@/api/errors';
import type { Transport } from '@/api/fixture-transport';
import type { EnterableOrganization, OrganizationClient } from '@/api/organization';

export interface OrganizationSelection {
  /** Draw the picker instead of the screen. */
  readonly required: boolean;
  /** A probe or the picker is in flight. */
  readonly loading: boolean;
  /** `null` until the picker has answered. `[]` is a real, renderable answer. */
  readonly options: EnterableOrganization[] | null;
  /** The identifier currently being submitted, so one button shows busy. */
  readonly submitting: string | null;
  /** A failure from the picker or from selection. Never a business error. */
  readonly error: ApiError | null;
  /**
   * The option the person chose is no longer offered — the race the contract
   * names. The picker has been refreshed; this explains why it changed.
   */
  readonly staleChoice: boolean;
  /**
   * Bumped on every successful selection. Screens key their reads on it, which
   * is how "retry the original request once" is served without any screen
   * knowing this hook exists.
   */
  readonly nonce: number;
  readonly choose: (organizationId: string) => void;
  readonly refresh: () => void;
}

export function useOrganization(
  transport: Transport,
  organizations: OrganizationClient,
  /**
   * What the session probe already learned, so a cold start does not probe
   * twice. `settled` gates the signal listener: until the session probe has
   * answered, its own 422 would otherwise start a second, identical probe.
   */
  seed: { settled: boolean; organizationRequired: boolean; authenticated: boolean },
): OrganizationSelection {
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<EnterableOrganization[] | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [staleChoice, setStaleChoice] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [pickerNonce, setPickerNonce] = useState(0);

  // Read inside callbacks that must not re-subscribe when these change.
  const busy = useRef(false);
  const requiredRef = useRef(false);
  requiredRef.current = required;
  /** Identifiers auto-selection has already tried, so it never tries one twice. */
  const attempted = useRef<Set<string>>(new Set());

  /* ---------------------------------------------------------------------
     Entry 1: the session probe already answered
     --------------------------------------------------------------------- */
  useEffect(() => {
    if (seed.settled && seed.organizationRequired) setRequired(true);
  }, [seed.settled, seed.organizationRequired]);

  /* ---------------------------------------------------------------------
     Signing out discards everything this hook knows
     --------------------------------------------------------------------- */
  /*
   * Otherwise a person who signs out at the picker and signs back in — as a
   * DIFFERENT principal, which is the case that matters — is shown the previous
   * principal's Organization list while their own session is resolved. It is
   * only a stale render and never a cross-tenant read, because the server
   * decides the tenant from the session and would refuse a selection this
   * principal may not make. It is still someone else's list on someone's
   * screen, which is not a thing to leave lying around.
   */
  useEffect(() => {
    if (seed.authenticated) return;
    setRequired(false);
    setOptions(null);
    setError(null);
    setStaleChoice(false);
    setSubmitting(null);
    attempted.current = new Set();
  }, [seed.authenticated]);

  /* ---------------------------------------------------------------------
     Entry 2: a request was refused as a failed precondition
     --------------------------------------------------------------------- */
  useEffect(
    () =>
      onPreconditionFailed(() => {
        // Already open, already checking, or the session probe has not answered
        // yet — in all three cases there is nothing to learn from another probe.
        // The last is what stops a cold start with no Organization from probing
        // twice: the session probe's own 422 fires this signal.
        if (requiredRef.current || busy.current || !seed.settled) return;
        busy.current = true;
        setLoading(true);
        void probeSession(transport).then(
          (result) => {
            busy.current = false;
            setLoading(false);
            // ONLY the probe may open the picker. A 422 that was a business
            // precondition leaves this alone, and the screen shows its own
            // error as it always did.
            if (result.organizationRequired) setRequired(true);
          },
          () => {
            busy.current = false;
            setLoading(false);
          },
        );
      }),
    [transport, seed.settled],
  );

  /* ---------------------------------------------------------------------
     Load the picker whenever the gate is open
     --------------------------------------------------------------------- */
  useEffect(() => {
    if (!required) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    organizations.listEnterable().then(
      (list) => {
        if (cancelled) return;
        setLoading(false);
        setOptions(list);
      },
      (thrown) => {
        if (cancelled) return;
        setLoading(false);
        setOptions(null);
        setError(toApiError(thrown));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [required, organizations, pickerNonce]);

  /* ---------------------------------------------------------------------
     Selection
     --------------------------------------------------------------------- */
  const choose = useCallback(
    (organizationId: string) => {
      if (submitting !== null) return;
      setSubmitting(organizationId);
      setError(null);
      setStaleChoice(false);
      organizations.select(organizationId).then(
        () => {
          setSubmitting(null);
          setOptions(null);
          setRequired(false);
          // The screens' reads are keyed on this. Bumping it IS the contract's
          // "retry the original request once" — and it is once, because nothing
          // re-runs until the next successful selection.
          setNonce((value) => value + 1);
        },
        (thrown) => {
          const apiError = toApiError(thrown);
          setSubmitting(null);
          if (apiError.code === 'not_found') {
            /*
             * THE RACE THE CONTRACT NAMES. A membership revoked between the
             * picker answering and this call produces a `404` for an option
             * just displayed. It is refreshed and explained — NOT reported as a
             * bug, and NOT read as "that Organization does not exist", which is
             * a distinction this client cannot make and must not try to.
             *
             * There is no retry: a `404` is final for that identifier until the
             * picker says otherwise.
             */
            setStaleChoice(true);
            setPickerNonce((value) => value + 1);
            return;
          }
          setError(apiError);
        },
      );
    },
    [organizations, submitting],
  );

  /* ---------------------------------------------------------------------
     Exactly one Organization: select it without drawing a picker
     --------------------------------------------------------------------- */
  /*
   * A PRESENTATION CHOICE, AND THE REQUEST IS STILL MADE. `0021` struck
   * server-side auto-selection and the contract's wording is the reason: "IT IS
   * NOT A DEFAULT AND IT IS NOT A SERVER BEHAVIOUR — the request is still made,
   * the hint is still validated, and the server still has no fallback. A client
   * that skips step 4 is not logged in anywhere."
   *
   * So this skips the MENU, never the CALL. A client with one option need not
   * draw a list; it still has to say which one. The request it sends is
   * byte-identical to the one a drawn picker would have sent, which is exactly
   * why the server cannot tell and deliberately does not record the difference.
   */
  useEffect(() => {
    if (!required || submitting !== null || error !== null) return;
    if (options === null || options.length !== 1) return;
    const only = options[0];
    // `noUncheckedIndexedAccess`: length 1 guarantees this, but the compiler is
    // asked to prove it rather than told.
    if (!only) return;
    // A single option that has ALREADY been refused is not auto-selected again.
    // Without this the 404 race becomes a loop: refresh returns the same one
    // option, which is auto-selected, which 404s, which refreshes. The person
    // sees the picker instead and chooses deliberately.
    if (attempted.current.has(only.organization_id)) return;
    attempted.current.add(only.organization_id);
    choose(only.organization_id);
  }, [required, options, submitting, error, choose]);

  const refresh = useCallback(() => {
    setError(null);
    setStaleChoice(false);
    setPickerNonce((value) => value + 1);
  }, []);

  return {
    required,
    loading,
    options,
    submitting,
    error,
    staleChoice,
    nonce,
    choose,
    refresh,
  };
}
