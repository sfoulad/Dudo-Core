# connectors/ — Adapters to external platforms

**Owner: `plugin-agent`**

A Connector adapts an external platform to a Dudo capability contract. Payments,
messaging, email, shipping, accounting, IoT — each provider implements the standard
interface for its capability.

## The point of this boundary

Apps depend on **capabilities**, never on vendors:

```
E-commerce App  ──►  Payment capability  ──►  Stripe connector
                                         ──►  BenefitPay connector
                                         ──►  Tap connector
```

The App calls `AuthorizePayment` and does not know or care which provider answers.
Swapping providers, or adding one, changes nothing in the App.

**The forbidden shape is a direct dependency:** an App reaching a vendor SDK, or Core
depending on an external integration. External integrations never become dependencies of
Core.

## Rules

- A Connector implements a capability contract published by Core. It does not invent its
  own interface.
- **No direct database access.** Connectors reach Dudo only through contracts, exactly
  like any other extension.
- Credentials belong in the approved secret store, referenced by name. **Never in this
  repository** — it is public.
- Outbound calls pass through controlled egress where the platform provides it, so
  allowed domains, rate limits, logging, and credential injection stay enforceable.
- Failures are the Connector's to contain. A provider outage must not take down the
  capability for other providers.

*Empty. Connectors arrive in Phase 5, after the capability contracts they implement.*
