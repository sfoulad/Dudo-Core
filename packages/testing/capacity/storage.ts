/**
 * ===========================================================================================
 * BYTES PER ROW, MEASURED BY WRITING ROWS AND LOOKING.
 * ===========================================================================================
 *
 * **STORAGE IS THE ALLOWANCE THAT DOES NOT EBB.** Transactions recover at midnight; a customer's
 * history does not. `0030` names it as the pinch point and the register puts the ceiling at
 * **500 MB per database** with 5 GB across the account — and `0006` chose one shared database, so
 * the per-database limit is the one that binds.
 *
 * That makes this the measurement that decides whether the honest answer is *"N businesses"* or
 * *"N businesses for M months"*.
 *
 * ===========================================================================================
 * HOW, AND WHAT IT IS NOT
 * ===========================================================================================
 *
 * A real database, the real migrations, N realistic rows, and `page_count * page_size` before and
 * after. **The difference divided by N is bytes per row INCLUDING its index entries**, which is
 * what a capacity model needs and what a column-width calculation would miss.
 *
 * IT IS NOT D1's BILLING FIGURE. D1 is SQLite so the page arithmetic is the same shape, but
 * Cloudflare's reported database size is not visible from here. These are measured bytes for a
 * schema and a row shape.
 */

import { databaseBytes } from './measure.ts';
import type { SqliteHarness } from '../harness/sqlite-d1.ts';
import {
  FIXTURE_CREATED_AT,
  createPlatformControlPlane,
  createTenantDatabase,
} from '../harness/platform-fixture.ts';

export type RowSize = {
  readonly table: string;
  readonly rows: number;
  readonly bytesTotal: number;
  readonly bytesPerRow: number;
  /** What a row of this shape represents, so the model can multiply by the right thing. */
  readonly meaning: string;
};

const SAMPLE = 2_000;

function measureTable(
  harness: SqliteHarness,
  table: string,
  meaning: string,
  insert: (index: number) => void,
): RowSize {
  const before = databaseBytes(harness);
  harness.raw.exec('BEGIN');
  for (let index = 0; index < SAMPLE; index += 1) {
    insert(index);
  }
  harness.raw.exec('COMMIT');
  const after = databaseBytes(harness);
  return {
    table,
    rows: SAMPLE,
    bytesTotal: after - before,
    // ROUNDED UP. A capacity model that rounds bytes-per-row down over-estimates how many
    // businesses fit, which is the dangerous direction.
    bytesPerRow: Math.ceil((after - before) / SAMPLE),
    meaning,
  };
}

function pad(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(12, '0')}`;
}

/**
 * The tables that GROW WITH USE, measured with realistic values.
 *
 * **THE SELECTION IS THE ARGUMENT.** A table that holds one row per Organization does not decide
 * capacity; a table that gains rows every day does. So: the two audit trails, the operator action
 * log, sessions, and the Customer table as the stand-in for tenant business data.
 *
 * `principal`, `organization`, `template` and `tenant_directory` are deliberately absent — they
 * grow with customers rather than with usage, and at the scale in question their total is noise
 * beside a year of audit rows. That is stated so a reader can disagree with it rather than
 * discover it.
 */
export function measureRowSizes(): RowSize[] {
  const sizes: RowSize[] = [];

  const control = createPlatformControlPlane();
  try {
    // THE FOREIGN-KEY TARGETS, SEEDED FIRST. `session`, `confirmation` and
    // `platform_operator_action` all reference a principal, and `session` references an
    // Organization. Measuring against a schema whose constraints are disabled would measure a
    // different database from the one that ships.
    control.raw
      .prepare("INSERT INTO principal (principal_id, principal_type, status, created_at) VALUES (?, 'user', 'active', ?)")
      .run('prn_tenant_owner0001', FIXTURE_CREATED_AT);
    control.raw
      .prepare("INSERT INTO principal (principal_id, principal_type, status, created_at) VALUES (?, 'user', 'active', ?)")
      .run('prn_platform_admin01', FIXTURE_CREATED_AT);
    control.raw
      .prepare("INSERT INTO organization (organization_id, status, created_at) VALUES (?, 'active', ?)")
      .run('org_alpha_000000001', FIXTURE_CREATED_AT);
    control.raw
      .prepare("INSERT INTO platform_operator (principal_id, platform_role, created_at) VALUES (?, 'platform-admin', ?)")
      .run('prn_platform_admin01', FIXTURE_CREATED_AT);

    sizes.push(
      measureTable(
        control,
        'platform_operator_action',
        'one row per platform-operator request — EVERY request, including reads (P4)',
        (index) => {
          control.raw
            .prepare(
              'INSERT INTO platform_operator_action (action_record_id, actor_principal_id, ' +
                'actor_platform_role, action_id, target_kind, target_id, target_organization_id, ' +
                'outcome, occurred_at, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              pad('par_', index),
              'prn_platform_admin01',
              'platform-admin',
              'platform.organizations.audit.list',
              'organization',
              'org_alpha_000000001',
              'org_alpha_000000001',
              'ok',
              FIXTURE_CREATED_AT,
              pad('corr_', index),
            );
        },
      ),
    );

    sizes.push(
      measureTable(control, 'session', 'one row per active login, deleted on logout or expiry', (index) => {
        control.raw
          .prepare(
            'INSERT INTO session (session_id, principal_id, active_organization_id, created_at, ' +
              'expires_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(pad('ses_', index), 'prn_tenant_owner0001', 'org_alpha_000000001', FIXTURE_CREATED_AT, FIXTURE_CREATED_AT);
      }),
    );

    sizes.push(
      // FIVE COLUMNS, NOT THE EIGHT I FIRST WROTE. The table holds a binding hash, an id, a
      // principal, an expiry and a spent marker — no action id, no permission, no issued-at.
      // Written from `PRAGMA table_info` rather than from the migration's prose, because the
      // migration file's readable part and its DDL had already disagreed with my assumption once.
      measureTable(control, 'confirmation', 'one row per confirmation challenge issued', (index) => {
        control.raw
          .prepare(
            'INSERT INTO confirmation (binding_hash, confirmation_id, principal_id, expires_at, ' +
              'spent_at) VALUES (?, ?, ?, ?, NULL)',
          )
          .run(
            `${'a'.repeat(40)}${String(index).padStart(3, '0')}`,
            pad('cnf_', index),
            'prn_platform_admin01',
            FIXTURE_CREATED_AT,
          );
      }),
    );
  } finally {
    control.close();
  }

  const tenant = createTenantDatabase();
  try {
    sizes.push(
      measureTable(
        tenant,
        'audit_event',
        "one row per audited Action — the tenant's own trail, and the dominant grower",
        (index) => {
          tenant.raw
            .prepare(
              'INSERT INTO audit_event (audit_event_id, tenant_id, app_id, action_id, ' +
                'principal_id, principal_type, on_behalf_of_principal_id, permission_id, scope, ' +
                'decision, denial_reason, target_resource_id, target_unresolved, ' +
                'related_business_ids, actor_business_ids, changed_field_names, request_id, ' +
                'correlation_id, occurred_at) ' +
                'VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, 0, ?, ?, ?, ?, ?, ?)',
            )
            .run(
              pad('aud_', index),
              'org_alpha_000000001',
              'customers',
              'customers.UpdateCustomer',
              'prn_tenant_owner0001',
              'user',
              'customers.customer.update',
              'organization',
              'allowed',
              pad('cust_', index),
              '["biz_alpha_north001"]',
              '["biz_alpha_north001"]',
              '["display_name","email"]',
              pad('req_', index),
              pad('corr_', index),
              FIXTURE_CREATED_AT,
            );
        },
      ),
    );
  } finally {
    tenant.close();
  }

  return sizes;
}

/**
 * The Customer table, measured separately because it needs the App's own migration.
 *
 * REPORTED AS A SEPARATE STEP because a failure to apply that migration should be visible as a
 * missing measurement rather than as a silently smaller number.
 */
export function measureCustomerRowSize(applyCustomerSchema: (harness: SqliteHarness) => void): RowSize {
  const tenant = createTenantDatabase();
  try {
    applyCustomerSchema(tenant);
    // THE FULL COLUMN LIST, INCLUDING THE SEARCH KEYS. `display_name_key`, `email_key` and
    // `phone_key` are normalised duplicates the search path indexes — **they are real bytes and a
    // measurement that omitted them would under-report a customer row by a third.** The first
    // version of this insert named thirteen columns and failed on the NOT NULLs; the failure was
    // swallowed by a `catch` and reported as "could not measure", which is why the catch now
    // re-throws rather than hiding the reason.
    return measureTable(tenant, 'customer', 'one row per customer record a business holds', (index) => {
      tenant.raw
        .prepare(
          'INSERT INTO customer (tenant_id, customer_id, business_id, display_name, ' +
            'display_name_key, customer_type, email, email_key, phone, phone_key, country, ' +
            'address, notes, status, created_at, created_by_principal_id, updated_at, ' +
            'updated_by_principal_id) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          'org_alpha_000000001',
          pad('cust_', index),
          'biz_alpha_north001',
          `Customer Number ${String(index)}`,
          `customer number ${String(index)}`,
          'person',
          `customer.${String(index)}@example.invalid`,
          `customer.${String(index)}@example.invalid`,
          '+973 0000 0000',
          '+9730000000',
          'BH',
          'Building 000, Road 0000, Block 000, Manama',
          'A short note of the kind a salesperson actually writes.',
          'active',
          FIXTURE_CREATED_AT,
          'prn_tenant_owner0001',
          FIXTURE_CREATED_AT,
          'prn_tenant_owner0001',
        );
    });
  } finally {
    tenant.close();
  }
}
