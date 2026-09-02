/**
 * The physical column names, in one place.
 *
 * The App declares its entities in the manifest and defines them in `data/`
 * (APP_STANDARD.md §6). Physical storage layout is otherwise not the App's business: it
 * never names a database, never constructs a handle, and receives a tenant-scoped one.
 *
 * NOTE WHAT IS NOT DECLARED HERE: `tenant_id`. It is not in `CUSTOMER_COLUMNS`, it is not
 * read, and it is not written. The storage boundary sets it on insert and filters on it on
 * every read, and it rejects any spec that names it (platform/core/storage/store.ts). This
 * App has no value to put there and no way to ask for one.
 *
 * THE THREE DERIVED KEY COLUMNS, AND WHAT THEY COST.
 *
 * `display_name_key`, `email_key` and `phone_key` hold the normalised forms that search
 * matches against. They are stored rather than computed at query time because SQLite has no
 * NFC normalisation and no portable whitespace collapse, so the alternative is normalising
 * one side of every comparison in a different code path from the other — which is how a
 * directory ends up unable to find a name it displays.
 *
 * `phone_key` in particular is required rather than chosen. The contract states it as a
 * free-tier obligation: "a suffix match is not servable by an ordinary prefix index, so the
 * storage design must either keep a reversed-digit column or bound the scan."
 *
 * THE COST IS A DEVIATION FROM THE CONTRACT'S OWN STORAGE PROJECTION AND IS REPORTED AS
 * ONE. `freeTierImpact.rowSize` budgets ~424 bytes typical and ~3.15 KB worst case, for a
 * row without these columns. They add roughly 60 bytes typical and up to 487 bytes at the
 * worst case (a 200-character name key, a 254-character email key, 32 digits), so the
 * figures become roughly 484 bytes and 3.64 KB — about 5.7% and 39% of the 500 MB shared
 * ceiling at the contract's 50,000-row projection, against the 5% and 34% it states. Still
 * zero cost, still below every threshold in docs/decisions/0006 §0.4, and still a number
 * the Team Lead should have rather than discover.
 */

export const CUSTOMER_TABLE = 'customer';

export const COLUMN = {
  customerId: 'customer_id',
  businessId: 'business_id',
  displayName: 'display_name',
  /** Normalised, space-prefixed. Serves BOTH the fixed sort order and token matching. */
  displayNameKey: 'display_name_key',
  customerType: 'customer_type',
  email: 'email',
  emailKey: 'email_key',
  phone: 'phone',
  /** The stored phone's digits, REVERSED, so a suffix match is a prefix match. */
  phoneKey: 'phone_key',
  country: 'country',
  address: 'address',
  notes: 'notes',
  status: 'status',
  deletionScheduledAt: 'deletion_scheduled_at',
  createdAt: 'created_at',
  createdByPrincipalId: 'created_by_principal_id',
  updatedAt: 'updated_at',
  updatedByPrincipalId: 'updated_by_principal_id',
} as const;

/** The projection for `GetCustomer` and every mutation's response: the full record. */
export const CUSTOMER_COLUMNS: readonly string[] = [
  COLUMN.customerId,
  COLUMN.businessId,
  COLUMN.displayName,
  COLUMN.customerType,
  COLUMN.email,
  COLUMN.phone,
  COLUMN.country,
  COLUMN.address,
  COLUMN.notes,
  COLUMN.status,
  COLUMN.deletionScheduledAt,
  COLUMN.createdAt,
  COLUMN.createdByPrincipalId,
  COLUMN.updatedAt,
  COLUMN.updatedByPrincipalId,
];

/**
 * The projection for `ListCustomers` and `SearchCustomers`.
 *
 * `address` AND `notes` ARE ABSENT, AND THE ABSENCE IS THE POINT. The list projection is
 * what makes `list` a different permission from `read`: enumeration and record disclosure
 * are different risks. Reading a customer's address or notes requires `GetCustomer`, one
 * record at a time, under `customers.customer.read`.
 *
 * Narrowing the SELECT rather than trimming the object afterwards matters: a query that
 * fetched the free-text fields and then dropped them would put them in memory, in a log on
 * failure, and in whatever the storage layer traces — which is the disclosure the
 * projection exists to prevent, moved one layer down.
 */
export const CUSTOMER_SUMMARY_COLUMNS: readonly string[] = [
  COLUMN.customerId,
  COLUMN.businessId,
  COLUMN.displayName,
  COLUMN.customerType,
  COLUMN.email,
  COLUMN.phone,
  COLUMN.country,
  COLUMN.status,
  COLUMN.deletionScheduledAt,
  COLUMN.updatedAt,
];
