/**
 * The one place an `ApiError` becomes something a person reads.
 *
 * ===========================================================================
 * IT IS DELIBERATELY NOT IN `ui/`
 * ===========================================================================
 *
 * It was part of `components/StateBlock.tsx`, whose pure half moved to
 * `ui/panel.tsx` under ADR 0036. This half stayed behind because it imports
 * `@/api/errors`: it knows what an error envelope looks like, which of our error
 * codes are worth retrying, and that a `request_id` is the identifier support
 * asks for. That is the DATA LAYER, and `0036` is explicit that the two
 * administrations share a look and do not share a data layer. `ui/README.md`
 * states the rule; `npm run check:ui-purity` is what makes it hold.
 *
 * The developer-facing `message` is shown as a supporting line and the
 * `request_id` verbatim, because that identifier is what makes a support
 * conversation possible without anyone having to share the data involved.
 */

import type { ReactNode } from 'react';
import { Button, StateBlock } from '@dudo/ui';
import { ApiError, errorBody, errorTitle, isRetryable } from '@/api/errors';

/**
 * ⚠ `headingLevel` IS PASSED THROUGH BECAUSE THIS COMPONENT RENDERS IN TWO
 * PLACES THAT NEED DIFFERENT ANSWERS, AND IT CANNOT TELL WHICH IT IS IN.
 *
 * Three of its six call sites sit INSIDE a screen that already has an `h1`
 * (`CustomerList`, `CustomerDetail`, `CustomerForm`) — `h2` is right there.
 * **The other three ARE the whole page**: `AuthGate`'s probe failure and both
 * of `OrganizationGate`'s, where the gate short-circuits and the children never
 * render, so nothing above it supplies a heading at all. `AppShell` renders no
 * `h1` — measured, not assumed.
 *
 * Defaulting to `h2` keeps the common case correct with no argument, and the
 * caller that is the page says so. A component cannot infer its own depth.
 */
export function ErrorBlock({
  error,
  onRetry,
  retryLabel = 'Try again',
  extraActions,
  headingLevel = 'h2',
}: {
  error: ApiError;
  onRetry?: () => void;
  retryLabel?: string;
  extraActions?: ReactNode;
  headingLevel?: 'h1' | 'h2';
}) {
  const body = errorBody(error);
  return (
    <StateBlock
      glyph="!"
      tone="error"
      headingLevel={headingLevel}
      title={errorTitle(error)}
      body={
        <>
          <p>{body}</p>
          {error.message && error.message !== body ? (
            <p className="font-mono text-xs text-ink-faint">{error.message}</p>
          ) : null}
        </>
      }
      actions={
        <>
          {onRetry && isRetryable(error) ? (
            <Button variant="primary" onClick={onRetry}>
              {retryLabel}
            </Button>
          ) : null}
          {extraActions}
        </>
      }
      note={error.request_id ? `Reference ${error.request_id}` : null}
    />
  );
}
