/**
 * Route table and screen selection.
 *
 * `/customers/new` is matched before `/customers/:customer_id` so that "new" is
 * a screen rather than an identifier.
 */

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { CustomerList } from '@/screens/CustomerList';
import { CustomerDetail, NotFound } from '@/screens/CustomerDetail';
import { CustomerForm } from '@/screens/CustomerForm';
import { buildHash, matchPath, useLocation } from '@/lib/router';
import { setLastListHash } from '@/lib/last-list';
import { createCustomerDirectoryClient } from '@/api/client';
import { createFixtureTransport } from '@/api/fixture-transport';
import { createHttpTransport } from '@/api/http-transport';
import { signalUnauthenticated } from '@/api/session-signal';
import { createAuthClient } from '@/api/auth';
import { AuthGate } from '@/components/AuthGate';
import { useSession } from '@/lib/use-session';
import { CONFIG } from '@/api/config';

/**
 * The transport seam.
 *
 * ONE TERNARY IS THE WHOLE OF THE SWAP, and it is deliberately here rather than
 * hidden inside the client: which transport a build talks to is the single most
 * consequential fact about it, and it should be visible in the file a reader
 * opens first. `config.ts` refuses to start on an unrecognised value, so this
 * never silently falls back to fixtures.
 *
 * It is built OUTSIDE the component and memoised on nothing, because a new
 * transport identity would re-trigger every `useEffect` keyed on the client and
 * re-issue every in-flight read.
 */
function createTransport() {
  return CONFIG.transport === 'http'
    ? createHttpTransport({ onUnauthenticated: signalUnauthenticated })
    : createFixtureTransport();
}

export function App() {
  const { path, query } = useLocation();
  const transport = useMemo(createTransport, []);
  const client = useMemo(() => createCustomerDirectoryClient(transport), [transport]);
  const auth = useMemo(createAuthClient, []);
  const session = useSession(transport, auth);
  const [busy] = useState(false);

  // Remember the directory the person was looking at, so a record's back link
  // returns to the filtered list rather than to the top of the directory.
  useEffect(() => {
    if (path === '/customers') {
      setLastListHash(
        buildHash('/customers', {
          q: query.q,
          status: query.status,
          business: query.business,
          cursor: query.cursor,
        }),
      );
    }
  }, [path, query.q, query.status, query.business, query.cursor]);

  // Focus the main region on a route change so keyboard and screen-reader users
  // land on the new screen rather than staying where the previous one was.
  //
  // Only when nothing else has claimed focus. Child effects run before parent
  // effects, so a screen that deliberately focuses a control — the form focuses
  // its first field — would otherwise be overruled here a moment later. That is
  // not cosmetic: the resulting blur fired the form's own blur validation and
  // showed "This is required" on an untouched field the instant the page
  // opened.
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) {
      document.getElementById('main')?.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0 });
  }, [path]);

  return (
    <AppShell
      busy={busy}
      signedIn={session.state === 'authenticated'}
      signingOut={session.signingOut}
      onSignOut={session.signOut}
    >
      <AuthGate session={session} auth={auth}>
        <Screen path={path} client={client} />
      </AuthGate>
    </AppShell>
  );
}

function Screen({
  path,
  client,
}: {
  path: string;
  client: ReturnType<typeof createCustomerDirectoryClient>;
}) {
  if (matchPath('/customers', path)) {
    document.title = 'Customers · Dudo';
    return <CustomerList client={client} />;
  }

  if (matchPath('/customers/new', path)) {
    return <CustomerForm client={client} />;
  }

  const edit = matchPath('/customers/:customer_id/edit', path);
  if (edit?.customer_id) {
    return <CustomerForm client={client} customerId={edit.customer_id} />;
  }

  const detail = matchPath('/customers/:customer_id', path);
  if (detail?.customer_id) {
    return <CustomerDetail client={client} customerId={detail.customer_id} />;
  }

  document.title = 'Not found · Dudo';
  return <NotFound />;
}
