import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import '@/styles/index.css';

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
      <App />
    </StrictMode>,
  );
} catch (thrown) {
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
