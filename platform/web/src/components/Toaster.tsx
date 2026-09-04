/**
 * Transient confirmations and failures.
 *
 * A polite live region, so a screen reader announces "Customer archived"
 * without stealing focus. A toast is never the only place a result appears:
 * archiving also re-renders the record with its new status, so a missed toast
 * loses nothing.
 *
 * Hand-rolled rather than installed. It is about forty lines, and ADR 0016
 * approved React, Vite and Tailwind — not a notification library.
 */

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

export interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'error';
}

let nextId = 1;
const listeners = new Set<(toasts: Toast[]) => void>();
let current: Toast[] = [];

function emit(): void {
  for (const listener of listeners) listener(current);
}

export function toast(message: string, tone: 'default' | 'error' = 'default'): void {
  const item: Toast = { id: nextId++, message, tone };
  current = [...current, item];
  emit();
  window.setTimeout(() => dismiss(item.id), 5000);
}

export function dismiss(id: number): void {
  current = current.filter((item) => item.id !== id);
  emit();
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>(current);

  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  const onDismiss = useCallback((id: number) => dismiss(id), []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 start-1/2 z-40 grid w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 gap-2 rtl:translate-x-1/2"
    >
      {toasts.map((item) => (
        <div
          key={item.id}
          className={cn(
            'on-navy pointer-events-auto flex items-start gap-3 rounded-[7px] px-4 py-3 text-white shadow-[var(--shadow-float)]',
            item.tone === 'error' ? 'bg-scarlet-700' : 'bg-navy-800',
          )}
        >
          <span className="grow text-[0.9375rem]">{item.message}</span>
          <button
            type="button"
            aria-label="Dismiss this message"
            onClick={() => onDismiss(item.id)}
            className="shrink-0 cursor-pointer rounded-sm p-1 text-base leading-none opacity-75 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
