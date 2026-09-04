/**
 * Status and type badges — copy-in source, ours to edit.
 *
 * A status this client has never been taught renders in a neutral style rather
 * than crashing or rendering blank. Contract §11.1 requires that tolerance:
 * `pending_deletion` cannot occur in this slice, and a client must survive
 * meeting it.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import { statusLabel, typeLabel } from '@/contracts/format';
import type { CustomerStatus, CustomerType } from '@/contracts/customer-directory';

const badgeVariants = cva(
  'inline-flex items-center gap-2 rounded-sm px-2 py-0.5 text-xs font-bold tracking-[0.03em] whitespace-nowrap',
  {
    variants: {
      tone: {
        active: 'bg-green-50 text-green-700',
        archived: 'bg-gold-50 text-gold-700',
        pending: 'bg-scarlet-50 text-scarlet-700',
        unknown: 'bg-sunk text-ink-muted',
      },
    },
    defaultVariants: { tone: 'unknown' },
  },
);

function toneFor(status: string): NonNullable<VariantProps<typeof badgeVariants>['tone']> {
  switch (status as CustomerStatus) {
    case 'active':
      return 'active';
    case 'archived':
      return 'archived';
    case 'pending_deletion':
      return 'pending';
    default:
      return 'unknown';
  }
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn(badgeVariants({ tone: toneFor(status) }), className)}>
      <span aria-hidden="true" className="size-[0.4375rem] rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}

const tagVariants = cva(
  'inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-semibold tracking-[0.02em]',
  {
    variants: {
      tone: {
        person: 'border-azure-50 bg-azure-50 text-azure-700',
        company: 'border-navy-100 bg-navy-50 text-navy-600',
        unknown: 'border-line-strong text-ink-muted',
      },
    },
    defaultVariants: { tone: 'unknown' },
  },
);

export function TypeTag({ type, className }: { type: string; className?: string }) {
  const tone: NonNullable<VariantProps<typeof tagVariants>['tone']> =
    (type as CustomerType) === 'person'
      ? 'person'
      : (type as CustomerType) === 'company'
        ? 'company'
        : 'unknown';

  return <span className={cn(tagVariants({ tone }), className)}>{typeLabel(type)}</span>;
}
