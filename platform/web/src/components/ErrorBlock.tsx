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

export function ErrorBlock({
  error,
  onRetry,
  retryLabel = 'Try again',
  extraActions,
}: {
  error: ApiError;
  onRetry?: () => void;
  retryLabel?: string;
  extraActions?: ReactNode;
}) {
  const body = errorBody(error);
  return (
    <StateBlock
      glyph="!"
      tone="error"
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
