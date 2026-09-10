/**
 * A segmented control — one choice from a short, fixed set.
 *
 * Generalised from the Customer Directory's status tabs, which every admin list
 * will want a version of. It is a `role="group"` of `aria-pressed` buttons
 * rather than a `role="tablist"`, deliberately: a tablist promises that each tab
 * reveals an associated panel, and this reveals nothing — it changes a filter on
 * the one region that was already there.
 *
 * IT IS A FILTER, NOT A PERMISSION. A caller that wants to omit an option omits
 * it for a presentation reason and gets no security from doing so: every value
 * is reachable by editing the URL and the server is what refuses
 * (`security.md` §2). Nothing in this file consults, caches or infers what a
 * viewer may do.
 */

import { cn } from './cn';

export interface SegmentedOption<TValue extends string> {
  value: TValue;
  label: string;
}

export interface SegmentedControlProps<TValue extends string> {
  /** Names the group for a screen reader — "Filter by status". */
  label: string;
  options: readonly SegmentedOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  className?: string;
}

export function SegmentedControl<TValue extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex rounded-[7px] border border-line bg-sunk p-0.5', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-7.5 cursor-pointer rounded-sm border-0 px-3 py-1 text-[0.8125rem] font-semibold',
            option.value === value
              ? 'bg-surface text-navy-800 shadow-[var(--shadow-card)]'
              : 'bg-transparent text-ink-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
