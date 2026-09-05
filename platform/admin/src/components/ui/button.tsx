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
 * Every spacing and radius utility here is LOGICAL — no left/right, `border-e`
 * rather than `border-r` — so an RTL document needs no stylesheet change.
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

export function Button({ className, variant, size, busy, children, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props}>
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
