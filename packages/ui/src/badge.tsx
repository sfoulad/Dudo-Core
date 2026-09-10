/**
 * Badge and Tag — copy-in source in the shadcn/ui manner, ours to edit.
 *
 * ===========================================================================
 * WHAT CHANGED HERE, AND WHY IT IS THE POINT OF ADR 0036's PRIMITIVE LAYER
 * ===========================================================================
 *
 * This file used to export `StatusBadge` and `TypeTag`, which imported the
 * Customer Directory's types and mapped a customer's status onto a colour. That
 * made the shared primitive layer depend on one App's domain vocabulary: the
 * second surface to need a coloured pill — an operator's Organization state, a
 * manifest's lifecycle, a queue's health — would either import the Customer
 * Directory to get one, or write its own.
 *
 * So the mapping moved out (`platform/web/src/components/CustomerBadges.tsx`)
 * and the rendering stayed. **A component that renders a labelled pill is
 * shared. A component that knows `pending_deletion` is amber is not.**
 * `README.md` states the rule and `npm run check:ui-purity` enforces it.
 *
 * TOLERANCE OF AN UNKNOWN VALUE IS PRESERVED AND IS STILL REQUIRED. A caller
 * that cannot classify a value passes `tone="unknown"`, which renders neutrally
 * rather than blank — `customer-directory-v1` §11.1 requires a client to survive
 * meeting a status it has never been taught, and that obligation now sits with
 * the caller doing the mapping, which is where it can actually be discharged.
 *
 * Every spacing utility here is LOGICAL — no left/right — so an RTL document
 * needs no stylesheet change.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import type { ReactNode } from 'react';
import { cn } from './cn';

export const badgeVariants = cva(
  'inline-flex items-center gap-2 rounded-sm px-2 py-0.5 text-xs font-bold tracking-[0.03em] whitespace-nowrap',
  {
    variants: {
      tone: {
        positive: 'bg-green-50 text-green-700',
        caution: 'bg-gold-50 text-gold-700',
        critical: 'bg-scarlet-50 text-scarlet-700',
        unknown: 'bg-sunk text-ink-muted',
      },
    },
    defaultVariants: { tone: 'unknown' },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  children: ReactNode;
  className?: string;
  /**
   * The leading dot. Decoration only — the label carries the meaning, which is
   * why it is `aria-hidden` and why colour is never the sole signal.
   */
  dot?: boolean;
}

export function Badge({ tone, className, children, dot = true }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      {dot ? <span aria-hidden="true" className="size-[0.4375rem] rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

export const tagVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold tracking-[0.02em]',
  {
    variants: {
      tone: {
        info: 'border-azure-50 bg-azure-50 text-azure-700',
        neutral: 'border-navy-100 bg-navy-50 text-navy-600',
        unknown: 'border-line-strong text-ink-muted',
      },
    },
    defaultVariants: { tone: 'unknown' },
  },
);

export type TagTone = NonNullable<VariantProps<typeof tagVariants>['tone']>;

export interface TagProps extends VariantProps<typeof tagVariants> {
  children: ReactNode;
  className?: string;
}

/** A quieter pill for a classification rather than a state. */
export function Tag({ tone, className, children }: TagProps) {
  return <span className={cn(tagVariants({ tone }), className)}>{children}</span>;
}
