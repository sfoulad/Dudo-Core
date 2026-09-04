/**
 * Button — copy-in source in the shadcn/ui manner.
 *
 * It lives in this repository and is ours to edit. It is NOT a package: ADR
 * 0016 is explicit that shadcn/ui is copy-in source and that no component
 * library may be added as a runtime dependency. `cva` is the variant helper
 * shadcn uses, so components copied in later work unmodified and this surface
 * can share components with the admin interface (ADR 0010, same stack).
 *
 * Every spacing and radius utility here is LOGICAL — no left/right — so an RTL
 * document needs no stylesheet change.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from 'react';
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
        primary: 'bg-scarlet-600 border-scarlet-600 text-white hover:not-disabled:bg-scarlet-700 hover:not-disabled:border-scarlet-700',
        secondary: 'bg-surface border-line-strong text-ink hover:not-disabled:bg-sunk hover:not-disabled:border-ink-faint',
        ghost: 'bg-transparent text-navy-600 hover:not-disabled:bg-navy-50',
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

/** An anchor styled as a button, for navigation rather than action. */
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
