import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The shadcn/ui class helper, unchanged in behaviour from upstream.
 *
 * `clsx` resolves conditionals into a class string; `twMerge` then removes
 * Tailwind classes that a later one overrides, so a caller passing
 * `className="p-6"` to a component whose default is `p-4` gets `p-6` rather than
 * two conflicting paddings whose winner depends on stylesheet order.
 *
 * Both are MIT (ADR 0010's licence obligation), both are single-purpose, and
 * both are what every shadcn component copied into this codebase expects to
 * import. Writing a local substitute would mean editing every component that is
 * meant to be copied unchanged from upstream.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
