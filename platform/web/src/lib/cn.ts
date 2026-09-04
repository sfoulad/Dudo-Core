import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The class-name helper every shadcn/ui component expects.
 *
 * It exists so copy-in components work unmodified and so this surface and the
 * admin interface (ADR 0010, same stack) can share components rather than
 * diverging. `twMerge` resolves conflicting Tailwind utilities so a caller's
 * `className` reliably wins over a component's default.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
