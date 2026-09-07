/**
 * Button — copy-in source in the shadcn/ui manner.
 *
 * It lives in this repository and is ours to edit. It is NOT a package: ADR 0010
 * adopts shadcn/ui as components COPIED INTO THE CODEBASE BY DESIGN, with
 * attribution preserved, and no component library is added as a runtime
 * dependency. `cva` is the variant helper shadcn uses, so components copied in
 * later work unmodified.
 *
 * THIS IS THE SAME COMPONENT `platform/web` HOLDS, DELIBERATELY. Its header
 * anticipates the sharing — "this surface can share components with the admin
 * interface (ADR 0010, same stack)" — and one visual language across the two
 * clients is the point of adopting one component foundation. Unlike
 * `api/kdf.ts`, THIS COPY IS NOT UNDER A DRIFT CHECK: a button that diverges is
 * a cosmetic difference, not a cross-client outage, and freezing presentation
 * would stop either console from evolving its own surface.
 *
 * Every spacing and radius utility here is LOGICAL — inline-start and inline-end
 * rather than left and right — so an RTL document needs no stylesheet change.
 * The physical class names are deliberately not spelled out: Tailwind scans raw
 * text, so naming one in prose compiles it into the bundle, and the CSS check
 * fails on any physical inline-axis property in the artifact.
 *
 * Upstream: shadcn/ui and satnaing/shadcn-admin, both MIT. See NOTICE.md.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[7px]',
    'font-semibold leading-none transition-colors cursor-pointer',
    'border border-transparent no-underline',
    'disabled:cursor-not-allowed disabled:opacity-55',
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-55',
  ),
  {
    variants: {
      variant: {
        primary:
          'bg-scarlet-600 border-scarlet-600 text-white hover:not-disabled:bg-scarlet-700 hover:not-disabled:border-scarlet-700',
        secondary:
          'bg-surface border-line-strong text-ink hover:not-disabled:bg-sunk hover:not-disabled:border-ink-faint',
        ghost: 'bg-transparent text-navy-600 hover:not-disabled:bg-navy-50',
        /**
         * For the navy chrome. The sidebar and header are dark, and the
         * `secondary` variant's warm surface on navy is unreadable — this is a
         * console-only variant rather than a change to a shared one.
         */
        onNavy:
          'bg-white/10 border-white/25 text-white hover:not-disabled:bg-white/20 hover:not-disabled:border-white/40',
      },
      size: {
        default: 'min-h-[2.375rem] px-4 text-[0.9375rem]',
        sm: 'min-h-8 px-3 text-[0.8125rem]',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  busy?: boolean;
  /** React 19 passes `ref` as an ordinary prop — no forwardRef needed. */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * ===========================================================================
 * IT DEFAULTS TO `type="button"`, AND THAT DEFAULT IS A DEFECT FIX
 * ===========================================================================
 *
 * HTML's default for a `<button>` inside a `<form>` is **`submit`**. So every
 * untyped button in a form submits it — including the ones whose entire purpose
 * is not to.
 *
 * THAT WAS NOT HYPOTHETICAL HERE. `ConfirmationGate`'s **Cancel** sat inside the
 * approval form with no `type`, so clicking it fired `onCancel` **and** the
 * form's `onSubmit`. With both re-authentication fields filled, `approve` would
 * pass its identifier check and **carry out the destructive action the operator
 * had just declined.** The same shape was in `PlatformAudit`'s "Clear" and
 * `Templates`' secondary controls, where the cost is a stray request rather than
 * a revoked operator.
 *
 * FIXED HERE RATHER THAN AT EACH CALL SITE, because per-site `type="button"` is
 * a discipline that a new button silently escapes — and the failure is invisible
 * until someone clicks the safe-looking control. A submitting button must now
 * say so, which is the direction the risk should point.
 *
 * `type="submit"` is explicit on the seven controls that genuinely submit, and
 * `scripts/verify-platform.mjs` asserts that every `<Button>` inside a `<form>`
 * either says `type="submit"` or is not meant to submit.
 */
export function Button({
  className,
  variant,
  size,
  busy,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {busy ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 animate-spin rounded-full border-2 border-current border-e-transparent"
    />
  );
}
