import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The class-name helper every shadcn/ui component expects.
 *
 * It exists so copy-in components work unmodified, and so `app.dudo.work` and
 * `admin.dudo.work` share components rather than diverging. `twMerge` resolves
 * conflicting Tailwind utilities so a caller's `className` reliably wins over a
 * component's default.
 *
 * MOVED HERE FROM `platform/web/src/lib/cn.ts` (ADR 0040). Both consoles carried
 * a copy; the two differed by 302 bytes and **their code was byte-identical** —
 * five lines under two sets of prose. That measurement is why the merge of this
 * one file was the only part of `0040` with nothing to decide.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
