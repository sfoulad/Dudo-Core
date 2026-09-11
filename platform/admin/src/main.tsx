import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { router } from '@/routes/route-tree';
import { createQueryClient } from '@/lib/query-client';
import { LocaleProvider } from '@/lib/i18n';
import '@/styles/index.css';

/*
 * ONE QUERY CLIENT, CREATED ONCE, OUTSIDE RENDER. A second one silently halves
 * the cache and re-issues every read — and on this console a re-issued read is
 * an audit row describing nothing an operator did.
 */
const queryClient = createQueryClient();

/**
 * Entry point.
 *
 * ===========================================================================
 * A CONFIGURATION ERROR IS RENDERED, NOT SWALLOWED
 * ===========================================================================
 *
 * `api/config.ts` throws at module load on a cross-origin API base, because such
 * a build would appear to sign in and then be refused on every call afterwards
 * with nothing in the UI to say why (ADR 0022 — the session cookie is host-only
 * and Core sets no CORS credential headers).
 *
 * A throw during module evaluation leaves a WHITE PAGE and a console message
 * nobody is looking at. So it is caught here and drawn, in plain HTML, with the
 * reason. THE MESSAGE IS THE ERROR'S OWN and never carries a configured value
 * beyond the origin the reader can already see in their address bar — no
 * secret is readable through `import.meta.env` in any case, since everything
 * Vite substitutes is embedded in the public bundle.
 */

const container = document.getElementById('root');

if (container === null) {
  throw new Error('The #root element is missing from index.html.');
}

try {
  createRoot(container).render(
    <StrictMode>
      {/*
        LOCALE OUTSIDE THE ROUTER, NOT INSIDE IT.

        `dir` is written to `<html>` and is inherited by everything — including
        anything the router renders before a route resolves, and including the
        configuration-error path below. A provider mounted inside the router
        would leave those in the document's default direction, which is the
        subset of the console a person is most likely to be looking at when
        something has gone wrong.
      */}
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </LocaleProvider>
    </StrictMode>,
  );
} catch (thrown) {
  /*
   * ⚠ THIS ONE STAYS ENGLISH, AND IT IS THE ONLY OPERATOR-FACING STRING ON THE
   * CONSOLE THAT DOES.
   *
   * **The catch fires when `LocaleProvider` failed to mount**, so there is no
   * locale, no dictionary and no `t` — reaching for one here would throw inside
   * the handler for a throw. This is the message shown when the React tree did
   * not start at all, written into a bare DOM node.
   *
   * Named here so the next reader does not translate a string that cannot reach
   * a translator, and so the copy pin's exemption for `main.tsx` has a reason
   * attached rather than being a filename on a list.
   */
  const message =
    thrown instanceof Error ? thrown.message : 'The console could not start on this build.';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  paragraph.setAttribute('role', 'alert');
  paragraph.style.cssText =
    'margin:2rem auto;max-width:44rem;padding:1.25rem;border:2px solid #c81e28;' +
    'border-radius:7px;background:#fdedec;color:#191b22;font:1rem/1.6 system-ui,sans-serif';
  container.replaceChildren(paragraph);
}
