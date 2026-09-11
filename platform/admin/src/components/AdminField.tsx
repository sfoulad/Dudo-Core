/**
 * `Field`, with this console's announcement policy applied once.
 *
 * ===========================================================================
 * WHY THIS EXISTS RATHER THAN `announce="assertive"` AT NINETEEN CALL SITES
 * ===========================================================================
 *
 * `@dudo/ui`'s `Field` defaults to `announce="polite"`, and that default is
 * correct for the shared package: **`assertive` carries a precondition** — the
 * errors must be set on SUBMIT and CLEARED on change, so the announcement fires
 * once per attempt rather than once per keystroke. `platform/web`'s customer
 * form re-validates as the user types and must not have it.
 *
 * **This console meets the precondition and has always used the assertive
 * behaviour.** Before ADR 0040 it was unconditional: admin's private copy of
 * `Field` hard-coded `role="alert"`, with the reasoning that `aria-describedby`
 * alone is read when a screen-reader user ARRIVES at an input, while these
 * errors appear on submit with focus on the button — so the user hears nothing
 * and the form simply does not proceed.
 *
 * **THE POLICY IS A PROPERTY OF THIS CONSOLE, SO IT BELONGS TO THIS CONSOLE, IN
 * ONE PLACE.** Nineteen call sites each passing `announce="assertive"` would be
 * the same decision written nineteen times, and the twentieth — added six months
 * from now by someone who did not know — would silently be polite. **A default
 * that has to be remembered at every call site is not a default.**
 *
 * ===========================================================================
 * IT IS NOT A SECOND PRIMITIVE LAYER, AND THE DISTINCTION IS THE WHOLE POINT
 * ===========================================================================
 *
 * `0040` exists because two consoles had two copies of the same components. This
 * is not that: it renders nothing of its own, owns no markup, and adds no
 * behaviour. **It applies one host's policy to a shared component and forwards
 * everything else**, so a change to `Field` still reaches both consoles.
 *
 * If this file ever grows markup, it has become a fork and the thing it forked
 * from should have taken the change instead.
 */

import { Field, type FieldProps } from '@dudo/ui';

export function AdminField(props: FieldProps) {
  return <Field announce="assertive" {...props} />;
}

export type { FieldProps };
