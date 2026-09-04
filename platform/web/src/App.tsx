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
import { signalPreconditionFailed, signalUnauthenticated } from '@/api/session-signal';
import { createAuthClient } from '@/api/auth';
import { createOrganizationClient } from '@/api/organization';
import { AuthGate } from '@/components/AuthGate';
import { OrganizationGate } from '@/components/OrganizationGate';
import { useSession } from '@/lib/use-session';
import { useOrganization } from '@/lib/use-organization';
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
    ? createHttpTransport({
        onUnauthenticated: signalUnauthenticated,
        onPreconditionFailed: signalPreconditionFailed,
      })
    : createFixtureTransport();
}

export function App() {
  const { path, query } = useLocation();
  const transport = useMemo(createTransport, []);
  const auth = useMemo(createAuthClient, []);
  const organizations = useMemo(createOrganizationClient, []);
  const session = useSession(transport, auth);
  const organization = useOrganization(transport, organizations, {
    settled: session.settled,
    organizationRequired: session.organizationRequired,
    authenticated: session.state === 'authenticated',
  });

  /*
   * THE CLIENT'S IDENTITY IS THE RETRY.
   *
   * `organization.nonce` is not read here, and that is deliberate rather than a
   * mistake: it is in the dependency list so that a successful Organization
   * selection produces a NEW client object. Every screen keys its read effect
   * on `client`, so a new identity re-issues exactly the request that was
   * refused — which is the contract's "retry the original request ONCE",
   * served without a single screen knowing that Organization selection exists.
   *
   * ONCE, AND ONLY ONCE: nothing bumps the nonce again until the next
   * successful selection, so there is no path here that can loop.
   *
   * IT DOES NOT REPLAY WRITES. A create or an update refused with
   * `failed_precondition` is not re-submitted when selection completes — the
   * person presses the button again. Silently re-posting a write on the
   * client's initiative is a different thing from re-reading a list, and only
   * the second one is safe to do without being asked.
   */
  const client = useMemo(
    () => createCustomerDirectoryClient(transport),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transport, organization.nonce],
  );
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
        {/*
          INSIDE the auth gate, not beside it. Choosing an Organization is a
          thing only an authenticated person can do, and the picker's own route
          answers 401 without a session — so a signed-out visitor must reach the
          login form, never this.
        */}
        <OrganizationGate organization={organization}>
          <Screen path={path} client={client} />
        </OrganizationGate>
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
