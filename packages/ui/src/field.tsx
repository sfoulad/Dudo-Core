/**
 * Form primitives — copy-in source, ours to edit.
 *
 * Native `input`, `textarea` and `select` are used deliberately rather than
 * Radix wrappers. A native select is already accessible, already works with a
 * phone's system picker, and costs no dependency; ADR 0016 warns that every
 * dependency is a supply-chain surface. If a rich combobox is ever genuinely
 * needed, that is the moment to add Radix — not before.
 *
 * ===========================================================================
 * MERGED FROM TWO COPIES, 2026-09-09 (ADR 0040)
 * ===========================================================================
 *
 * `platform/web` contributed `Textarea`, `Select`, `ReadOnlyValue`, `required`
 * and `counter`. `platform/admin` contributed the one thing web's copy lacked
 * and needed: **an announced error**. See `announce` below.
 */

import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from './cn';

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

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(controlBase, 'min-h-24 resize-y leading-relaxed', className)}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        controlBase,
        // The chevron is drawn with a gradient rather than a background image
        // so it needs no asset, and `pe-8` keeps it clear of the text in both
        // reading directions.
        'appearance-none pe-8 bg-no-repeat',
        '[background-image:linear-gradient(45deg,transparent_50%,var(--color-ink-muted)_50%),linear-gradient(135deg,var(--color-ink-muted)_50%,transparent_50%)]',
        '[background-position:calc(100%-18px)_55%,calc(100%-13px)_55%]',
        '[background-size:5px_5px,5px_5px]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * How an error announces itself when it appears.
 *
 * ===========================================================================
 * THE PRECONDITION TRAVELS WITH THE PROP. READ IT BEFORE CHOOSING `assertive`.
 * ===========================================================================
 *
 * `aria-describedby` alone is NOT enough, and that is why this prop exists.
 * It makes the message part of the field's description — read when a
 * screen-reader user ARRIVES at the input. **But these errors are typically set
 * on SUBMIT, at which point focus is on the submit button, and the user hears
 * nothing: the form simply does not proceed, with no stated reason.**
 *
 * `'polite'` (the default) announces at the next opportunity without
 * interrupting. **It is the default because it is safe under LIVE
 * re-validation** — a form that re-validates on every keystroke would, under
 * `assertive`, interrupt the user on each one.
 *
 * `'assertive'` interrupts immediately and **carries a precondition the caller
 * is choosing along with it: the errors must be set on SUBMIT and CLEARED on
 * change, so the announcement fires once per attempt rather than once per
 * keystroke.** A form that re-validates as the user types must not ask for it.
 * `platform/admin` meets that precondition and uses it; `platform/web`'s
 * customer form re-validates on change after first blur and therefore does not.
 *
 * **This is where the precondition belongs.** It lived in a comment on one
 * host's private copy, which is exactly how the two consoles ended up with
 * different behaviour and no way to notice — the caller could not see the
 * constraint it was subject to. Now choosing the value means reading the rule.
 *
 * **AND NOTE WHAT THIS PROP IS**, because it is the first real test of `0036`'s
 * no-authority rule: it is presentation configuration. It decides how loudly a
 * message is read, and nothing about who may see it. **A prop that cannot be
 * described that way does not belong in this package.**
 */
export type FieldAnnounce = 'polite' | 'assertive';

export interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string | null;
  className?: string;
  counter?: { used: number; max: number };
  announce?: FieldAnnounce;
  children: (aria: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => ReactNode;
}

/**
 * A labelled field with its hint, character counter and error message wired
 * together.
 *
 * The label is a real `<label for>`, the hint and the error are joined into
 * `aria-describedby`, and `aria-invalid` is set only when there is an error —
 * so a screen reader hears the field name, the guidance, and then what is
 * wrong, in that order, without the author having to remember the plumbing at
 * every call site.
 */
export function Field({
  id,
  label,
  required,
  hint,
  error,
  className,
  counter,
  announce = 'polite',
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('grid gap-2', className)}>
      <label htmlFor={id} className="text-[0.8125rem] font-semibold text-ink-soft tracking-[0.01em]">
        {label}
        {required ? (
          <span aria-hidden="true" className="font-bold text-scarlet-600">
            {' '}
            *
          </span>
        ) : (
          <span className="font-normal text-ink-muted"> — optional</span>
        )}
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

      {counter ? (
        <p
          aria-hidden="true"
          className={cn(
            'text-xs tabular-nums text-ink-muted',
            counter.used > counter.max && 'font-bold text-scarlet-700',
          )}
        >
          {counter.used} / {counter.max}
        </p>
      ) : null}

      {error ? (
        <p
          id={errorId}
          // `alert` is implicitly assertive and `status` implicitly polite; the
          // role is used rather than a bare `aria-live` because it also gives
          // the region a meaning older assistive technology recognises.
          role={announce === 'assertive' ? 'alert' : 'status'}
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

/** A value the contract does not allow this form to change. */
export function ReadOnlyValue({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-h-10 items-center rounded-[7px] border border-dashed border-line-strong bg-sunk px-3 py-2 text-ink-soft">
      {children}
    </p>
  );
}
