/**
 * Customer Directory status and type pills.
 *
 * This is the DOMAIN half of what is now `@dudo/ui`'s `badge.tsx`:
 * the mapping from a `customer-directory-v1` value onto a tone and a label. It
 * is deliberately not in `ui/`, because `ui/` is shared between
 * `admin.dudo.work` and `app.dudo.work/settings` and must carry no App's
 * vocabulary (ADR 0036; `ui/README.md`; enforced by `npm run check:ui-purity`).
 *
 * A STATUS THIS CLIENT HAS NEVER BEEN TAUGHT RENDERS NEUTRALLY rather than
 * blank. Contract §11.1 requires that tolerance: `pending_deletion` cannot occur
 * in this slice, and a client must survive meeting it. The `default` arm below
 * is that requirement, and it is here rather than in the primitive because this
 * is the only file that knows what the values are.
 */

import { Badge, Tag, type BadgeTone, type TagTone } from '@dudo/ui';
import { statusLabel, typeLabel } from '@/contracts/format';
import type { CustomerStatus, CustomerType } from '@/contracts/customer-directory';

function toneForStatus(status: string): BadgeTone {
  switch (status as CustomerStatus) {
    case 'active':
      return 'positive';
    case 'archived':
      return 'caution';
    case 'pending_deletion':
      return 'critical';
    default:
      return 'unknown';
  }
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={toneForStatus(status)} className={className}>
      {statusLabel(status)}
    </Badge>
  );
}

function toneForType(type: string): TagTone {
  switch (type as CustomerType) {
    case 'person':
      return 'info';
    case 'company':
      return 'neutral';
    default:
      return 'unknown';
  }
}

export function TypeTag({ type, className }: { type: string; className?: string }) {
  return (
    <Tag tone={toneForType(type)} className={className}>
      {typeLabel(type)}
    </Tag>
  );
}
