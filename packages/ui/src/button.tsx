/**
 * Button — copy-in source in the shadcn/ui manner, ours to edit.
 *
 * It lives in this repository and is not a package we depend on: ADR 0016 is
 * explicit that shadcn/ui is copy-in source and that no component library may be
 * added as a runtime dependency. `cva` is the variant helper shadcn uses, so
 * components copied in later work unmodified.
 *
 * Every spacing and radius utility here is LOGICAL — no left/right — so an RTL
 * document needs no stylesheet change.
 *
 * ===========================================================================
 * MERGED FROM TWO COPIES, 2026-09-09 (ADR 0040). NEITHER WAS THE SOURCE.
 * ===========================================================================
 *
 * `0040` first said `platform/admin`'s copy should be DELETED because "there is
 * nothing in them to preserve", reasoning from a measurement that admin's file
 * was 80% larger with FEWER exports. **The measurement was right and the
 * inference was wrong: the excess was not only comments.** Admin's copy carried
 * two things web's did not, and both are below:
 *
 *   · the `onNavy` variant — which web needed and OPEN-CODED at its own call
 *     site, so deleting admin's would have lost the factoring rather than a
 *     duplicate;
 *   · `type = 'button'` as the default — see the note on it, which is a defect
 *     web had been carrying rather than a stylistic difference.
 *
 * Web's copy contributed `ButtonLink`. The result is the union, and the ADR was
 * corrected rather than executed.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from 'react';
import { cn } from './cn';

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
        /*
         * FOR A CONTROL SITTING ON THE NAVY HEADER, where `secondary`'s surface
         * and `ghost`'s navy text both disappear. It came from `platform/admin`,
         * which uses it twice in its shell.
         *
         * ⚠ CORRECTED. This comment first said `platform/web` "wrote the same
         * four utilities inline". IT DOES NOT, and the difference is visible:
         * web's sign-out button is `ghost` plus
         * `text-[#b9c0dd] hover:not-disabled:bg-white/10 hover:not-disabled:text-white`
         * — transparent and muted until hover. This variant is always-on: a
         * white-tinted surface with a border. **Both consoles needed a button
         * that works on navy and each solved it differently; only admin named
         * it.**
         *
         * So the merge keeps a capability web lacked — deleting admin's button
         * would still have lost it — but **web is NOT switched to this variant,
         * because that would be a visual change to its header rather than a
         * relocation.** That is a design decision and not part of ADR 0040.
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
 * `type` DEFAULTS TO `'button'`, AND THAT IS A FIX RATHER THAN A PREFERENCE.
 *
 * HTML defaults a `<button>` inside a `<form>` to `type="submit"`. A component
 * that does not set it therefore submits the form whenever an author forgets —
 * and the forgetting is silent, because the markup looks correct and the failure
 * is a page navigation rather than an error.
 *
 * `platform/admin` defaulted it; `platform/web` did not, and paid for it at five
 * separate call sites that each write `type="button"` by hand. **Defaulting it
 * once is the same fix applied in one place instead of five**, and a caller that
 * genuinely wants a submit button still says so explicitly — which is the right
 * way round, since submitting is the consequential one.
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

/**
 * An anchor styled as a button, for navigation rather than action.
 *
 * FOR A REAL HREF — a `mailto:`, a `tel:`, an external link. **A route is not
 * one of those.** Each console has its own router and its own route tree
 * (`0035`), and this package may import neither — `check:ui-purity` refuses it.
 * A screen linking to one of its own routes composes `buttonVariants()` with its
 * router's `Link`, which is one extra line at the call site and the reason the
 * shared layer stays shareable.
 */
export interface ButtonLinkProps
  extends AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonVariants> {}

export function ButtonLink({ className, variant, size, children, ...props }: ButtonLinkProps) {
  return (
    <a className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </a>
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
