/**
 * Form primitives — copy-in source, ours to edit.
 *
 * Native `input` is used deliberately rather than a Radix wrapper. A native
 * input is already accessible, already works with a phone's system keyboard and
 * password manager, and costs no dependency — and ADR 0010 requires every
 * retained dependency to justify itself and have its licence verified. THE SHELL
 * HAS NO DIALOG, MENU, COMBOBOX OR POPOVER, so no Radix primitive is installed
 * at all. That is the moment to add one, and it has not arrived.
 *
 * Upstream shape: shadcn/ui, MIT. See NOTICE.md.
 */

import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/cn';

const controlBase = cn(
  'w-full min-h-10 px-3 py-2 rounded-[7px] bg-surface text-ink',
  'border border-line-strong transition-colors',
  'hover:border-ink-faint',
  'aria-invalid:border-scarlet-600 aria-invalid:shadow-[inset_0_0_0_1px_var(--color-scarlet-600)]',
);

/** `ref` is an ordinary prop in React 19 — no forwardRef needed. */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

export function Input({ className, ...props }: InputProps) {
  return <input className={cn(controlBase, className)} {...props} />;
}

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  className?: string;
  children: (aria: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
}

/**
 * A labelled field with its hint and error message wired together.
 *
 * The label is a real `<label for>`, the hint and the error are joined into
 * `aria-describedby`, and `aria-invalid` is set only when there is an error — so
 * a screen reader hears the field name, the guidance, and then what is wrong, in
 * that order, without the author having to remember the plumbing at every call
 * site. ADR 0010 puts accessibility in the testing plan rather than in a
 * follow-up, and plumbing that has to be remembered is plumbing that gets
 * forgotten.
 *
 * THERE IS NO "— optional" SUFFIX AS THERE IS ON THE CUSTOMER CLIENT. Both
 * fields on the only form in this shell are required, and a required marker that
 * appears on every field carries no information.
 */
export function Field({ id, label, hint, error, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('grid gap-2', className)}>
      <label
        htmlFor={id}
        className="text-[0.8125rem] font-semibold text-ink-soft tracking-[0.01em]"
      >
        {label}
      </label>

      {children({
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      {hint ? (
        <p id={hintId} className="text-[0.8125rem] text-ink-muted">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          className="flex items-start gap-2 text-[0.8125rem] font-semibold text-scarlet-700"
        >
          <span
            aria-hidden="true"
            className="grid size-[1.05rem] shrink-0 place-items-center rounded-full bg-scarlet-600 text-xs text-white"
          >
            !
          </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
