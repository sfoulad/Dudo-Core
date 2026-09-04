/**
 * Fixture data for the Customer Directory.
 *
 * SYNTHETIC AND FICTIONAL, without exception. Every name is invented, every
 * email uses a reserved, non-routable example domain, and every phone number
 * and address is made up. Nothing here resembles a real person or a real
 * company, and nothing real may ever be added to it (security.md §6).
 *
 * Shapes follow packages/contracts/apps/customers/customer-directory-v1.schema.json
 * exactly: every one of the fifteen fields is present on every record, and an
 * optional field the tenant has not filled in is present and null — never
 * absent. Absent-versus-null is precisely the cross-client divergence the one
 * contract exists to prevent.
 *
 * The set is deliberately larger than one page (34 records against a default
 * page size of 25) so that pagination is real rather than theoretical, and it
 * includes:
 *   - records with null email, phone, country, address and notes,
 *   - `Müller` beside `Muller`, so the contract's no-accent-folding rule
 *     (CD-6) is visible in the product rather than only in the document,
 *   - six archived records, so the archived filter and the restore path have
 *     something to act on.
 */

const ORG_PRINCIPALS = {
  seed: 'prc_seed_import',
  kholoud: 'prc_kholoud_amin',
  sami: 'prc_sami_hadid',
};

/**
 * The Businesses of the one Organization these fixtures stand for.
 *
 * ⚠ NO CONTRACT EXISTS FOR THIS LIST. `business_id` is required on
 * CreateCustomer and is returned on every row, but nothing in
 * packages/contracts/** publishes "the Businesses this principal is authorized
 * over", or a display name for one. This shape is therefore a FIXTURE-ONLY
 * placeholder that has been reported to the Team Lead as a missing contract —
 * it is not a shape this client invented and intends to keep, and no view may
 * come to depend on a field of it beyond `business_id` and `display_name`.
 * Until that contract exists, the raw identifier is always available as the
 * fallback so the UI degrades to something true rather than something blank.
 */
export const FIXTURE_BUSINESSES = Object.freeze([
  { business_id: 'biz_marina_ops', display_name: 'Marina Trading W.L.L.' },
  { business_id: 'biz_atlas_logi', display_name: 'Atlas Logistics' },
  { business_id: 'biz_northgate1', display_name: 'Northgate Studio' },
]);

const B = {
  marina: 'biz_marina_ops',
  atlas: 'biz_atlas_logi',
  north: 'biz_northgate1',
};

/**
 * @param {Object} record - the fields that are actually set
 * @returns {Object} a full fifteen-field wire record
 */
function customer(record) {
  return Object.freeze({
    customer_id: record.customer_id,
    business_id: record.business_id,
    display_name: record.display_name,
    customer_type: record.customer_type,
    email: record.email ?? null,
    phone: record.phone ?? null,
    country: record.country ?? null,
    address: record.address ?? null,
    notes: record.notes ?? null,
    status: record.status ?? 'active',
    deletion_scheduled_at: record.deletion_scheduled_at ?? null,
    created_at: record.created_at,
    created_by_principal_id: record.created_by_principal_id ?? ORG_PRINCIPALS.seed,
    updated_at: record.updated_at ?? record.created_at,
    updated_by_principal_id: record.updated_by_principal_id ?? ORG_PRINCIPALS.seed,
  });
}

export const FIXTURE_CUSTOMERS = Object.freeze([
  customer({
    customer_id: 'cus_7Kq2mVx4', business_id: B.marina,
    display_name: 'Marina Bay Provisions W.L.L.', customer_type: 'company',
    email: 'accounts@marinabay.example.com', phone: '+973 1729 4410', country: 'BH',
    address: 'Building 2214, Road 4825\nBlock 428, Seef District\nManama',
    notes: 'Invoices go to the accounts inbox, never to the branch. Purchase order number required on every line.',
    created_at: '2026-01-14T08:12:00Z', updated_at: '2026-07-02T11:41:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.kholoud,
  }),
  customer({
    customer_id: 'cus_Pd9wR3nZ', business_id: B.atlas,
    display_name: 'Falcon Ridge Contracting', customer_type: 'company',
    email: 'hello@falconridge.example.net', phone: '+973 1755 0182', country: 'BH',
    address: 'Unit 7, Sitra Industrial Area\nSitra',
    notes: 'Site access needs 24 hours notice.',
    created_at: '2026-01-19T06:55:00Z',
  }),
  customer({
    customer_id: 'cus_Lm4tB8yQ', business_id: B.marina,
    display_name: 'Zallaq Coldstore Co.', customer_type: 'company',
    email: 'ops@zallaqcold.example.com', phone: '+973 1766 3390', country: 'BH',
    address: 'Warehouse 11, Zallaq Coast Road',
    notes: 'Dormant since the Zallaq site closed. Kept for the historical ledger.',
    status: 'archived',
    created_at: '2025-11-03T09:20:00Z', updated_at: '2026-05-28T14:03:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.sami,
  }),
  customer({
    customer_id: 'cus_Xr6vC1sK', business_id: B.north,
    display_name: 'Northgate Signal Ltd', customer_type: 'company',
    email: 'procurement@northgatesignal.example.net', phone: '+44 20 7946 0913', country: 'GB',
    address: '18 Calder Wharf\nLondon E1 4TR',
    notes: null,
    created_at: '2026-02-02T15:31:00Z',
  }),
  customer({
    customer_id: 'cus_Hn3jD7pW', business_id: B.north,
    display_name: 'Amber & Finch Studio', customer_type: 'company',
    email: 'studio@amberfinch.example.com', phone: '+44 161 496 0771', country: 'GB',
    address: 'Floor 3, Ochre Building\nManchester M4 1HN',
    notes: 'Prefers a single quarterly invoice.',
    created_at: '2026-02-11T10:02:00Z',
  }),
  customer({
    customer_id: 'cus_Ty8kF2mL', business_id: B.marina,
    display_name: 'Saffron Line Catering', customer_type: 'company',
    email: 'orders@saffronline.example.com', phone: '+973 3644 2210', country: 'BH',
    address: 'Shop 4, Adliya Block 338',
    notes: 'Deliveries before 09:00 only.',
    created_at: '2026-02-17T07:44:00Z',
  }),
  customer({
    customer_id: 'cus_Qw5nG9dR', business_id: B.atlas,
    display_name: 'Dilmun Paper Mills', customer_type: 'company',
    email: 'supply@dilmunpaper.example.net', phone: '+973 1783 5567', country: 'BH',
    address: 'Plot 3, Hidd Industrial Estate',
    notes: null,
    created_at: '2026-02-24T12:15:00Z',
  }),
  customer({
    customer_id: 'cus_Vb2hJ6xT', business_id: B.atlas,
    display_name: 'Blue Harbour Marine Services', customer_type: 'company',
    email: 'dispatch@blueharbour.example.com', phone: '+973 1731 8802', country: 'BH',
    address: 'Berth 9, Mina Salman',
    notes: 'Contact the harbourmaster before any evening collection.',
    created_at: '2026-03-01T05:10:00Z', updated_at: '2026-08-04T09:26:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.kholoud,
  }),
  customer({
    customer_id: 'cus_Zs9pK4cN', business_id: B.north,
    display_name: 'Müller Handelsgesellschaft mbH', customer_type: 'company',
    email: 'einkauf@muellerhandel.example.net', phone: '+49 40 7734 2200', country: 'DE',
    address: 'Speicherstrasse 14\n20457 Hamburg',
    notes: 'German-language correspondence preferred.',
    created_at: '2026-03-06T13:48:00Z',
  }),
  customer({
    customer_id: 'cus_Ck7mL1vB', business_id: B.atlas,
    display_name: 'Muller Freight Services', customer_type: 'company',
    email: 'bookings@mullerfreight.example.com', phone: '+44 151 496 3318', country: 'GB',
    address: 'Dock Gate 6\nLiverpool L3 4BQ',
    notes: 'Not related to the Hamburg company of a similar name.',
    status: 'archived',
    created_at: '2025-09-22T11:05:00Z', updated_at: '2026-04-19T16:12:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.sami,
  }),
  customer({
    customer_id: 'cus_Nj4qM8zV', business_id: B.north,
    display_name: 'Cobalt Row Analytics', customer_type: 'company',
    email: 'finance@cobaltrow.example.net', phone: null, country: 'GB',
    address: null,
    notes: 'Everything by email. They have asked twice not to be telephoned.',
    created_at: '2026-03-12T09:33:00Z',
  }),
  customer({
    customer_id: 'cus_Rf6sN3bH', business_id: B.marina,
    display_name: 'Riffa Print House', customer_type: 'company',
    email: 'jobs@riffaprint.example.com', phone: '+973 1777 4021', country: 'BH',
    address: 'Road 2825, Riffa',
    notes: 'Closed the print floor in June. Archived pending a decision.',
    status: 'archived',
    created_at: '2025-12-08T08:00:00Z', updated_at: '2026-06-30T10:55:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.kholoud,
  }),
  customer({
    customer_id: 'cus_Gd8tP5wJ', business_id: B.marina,
    display_name: 'Seef Tower Facilities', customer_type: 'company',
    email: 'fm@seeftower.example.net', phone: '+973 1758 1190', country: 'BH',
    address: 'Seef Tower, Level 12\nManama',
    notes: null,
    created_at: '2026-03-20T14:21:00Z',
  }),
  customer({
    customer_id: 'cus_Wq3rQ7nD', business_id: B.north,
    display_name: 'Orchard & Vale Foods', customer_type: 'company',
    email: 'buying@orchardvale.example.com', phone: '+44 117 496 2255', country: 'GB',
    address: 'Unit 22, Feeder Road\nBristol BS2 0TQ',
    notes: 'Seasonal ordering. Quiet between January and March.',
    created_at: '2026-03-27T11:09:00Z',
  }),
  customer({
    customer_id: 'cus_Bh5vR2mF', business_id: B.atlas,
    display_name: 'Kestrel Yard Engineering', customer_type: 'company',
    email: 'admin@kestrelyard.example.net', phone: '+973 1739 6604', country: 'BH',
    address: 'Yard 5, Askar',
    notes: 'Archived after the contract ended in May.',
    status: 'archived',
    created_at: '2025-10-15T07:30:00Z', updated_at: '2026-05-11T13:40:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.sami,
  }),
  customer({
    customer_id: 'cus_Ms7wS9pG', business_id: B.marina,
    display_name: 'Tashkeel Interiors W.L.L.', customer_type: 'company',
    email: 'projects@tashkeel.example.com', phone: '+973 3699 7714', country: 'BH',
    address: 'Showroom 3, Budaiya Highway',
    notes: null,
    created_at: '2026-04-02T09:47:00Z',
  }),
  customer({
    customer_id: 'cus_Jk2xT4rH', business_id: B.marina,
    display_name: 'Pearl Divers Coffee Roasters', customer_type: 'company',
    email: 'wholesale@pearldivers.example.net', phone: '+973 3312 6690', country: 'BH',
    address: 'Warehouse 2, Tubli',
    notes: 'Wholesale only. Retail enquiries go to the shop, not to us.',
    created_at: '2026-04-09T06:18:00Z',
  }),
  customer({
    customer_id: 'cus_Dl9yU6sK', business_id: B.north,
    display_name: 'Lantern Bay Hospitality', customer_type: 'company',
    email: null, phone: '+44 131 496 8020', country: 'GB',
    address: '4 Lantern Close\nEdinburgh EH6 6QU',
    notes: 'No email on file. Everything is arranged by telephone.',
    created_at: '2026-04-16T15:52:00Z',
  }),

  customer({
    customer_id: 'cus_An4zV8tM', business_id: B.marina,
    display_name: 'Amal Rashid Al-Fardan', customer_type: 'person',
    email: 'amal.alfardan@example.com', phone: '+973 3901 2244', country: 'BH',
    address: 'Villa 118, Road 3609\nBlock 336, Adliya',
    notes: 'Invoices in her own name, not the practice name.',
    created_at: '2026-01-22T10:11:00Z',
  }),
  customer({
    customer_id: 'cus_Yu6aW1vP', business_id: B.marina,
    display_name: 'Yusuf Haddad', customer_type: 'person',
    email: 'yusuf.haddad@example.com', phone: '+973 3655 8871', country: 'BH',
    address: 'Flat 22, Building 940, Road 1425\nIsa Town',
    notes: null,
    created_at: '2026-02-05T08:29:00Z',
  }),
  customer({
    customer_id: 'cus_Pr8bX3wQ', business_id: B.north,
    display_name: 'Priya Nandakumar', customer_type: 'person',
    email: 'priya.nandakumar@example.net', phone: '+91 80 4967 2210', country: 'IN',
    address: '14 Rosewood Lane\nBengaluru 560034',
    notes: 'Timezone: five and a half hours ahead of Manama.',
    created_at: '2026-02-13T12:04:00Z',
  }),
  customer({
    customer_id: 'cus_Tf3cY5xR', business_id: B.north,
    display_name: 'Tomás Ferreira', customer_type: 'person',
    email: 'tomas.ferreira@example.com', phone: '+351 21 496 3320', country: 'PT',
    address: 'Rua das Amoreiras 88\n1250-024 Lisboa',
    notes: null,
    created_at: '2026-02-20T17:15:00Z',
  }),
  customer({
    customer_id: 'cus_Ns5dZ7yT', business_id: B.marina,
    display_name: 'Noor Al-Sayegh', customer_type: 'person',
    email: 'noor.alsayegh@example.com', phone: '+973 3388 4402', country: 'BH',
    address: null,
    notes: 'Address still to be collected.',
    created_at: '2026-02-27T09:41:00Z',
  }),
  customer({
    customer_id: 'cus_Do7eA9zV', business_id: B.atlas,
    display_name: 'Daniel Okonkwo', customer_type: 'person',
    email: 'daniel.okonkwo@example.net', phone: '+234 1 496 7781', country: 'NG',
    address: '9 Harbour View Road\nLagos',
    notes: 'Moved to a different supplier in April. Archived rather than deleted.',
    status: 'archived',
    created_at: '2025-08-30T13:22:00Z', updated_at: '2026-04-24T08:17:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.kholoud,
  }),
  customer({
    customer_id: 'cus_Lm9fB2ax', business_id: B.marina,
    display_name: 'Layla Mansour', customer_type: 'person',
    email: 'layla.mansour@example.com', phone: '+973 3922 0165', country: 'BH',
    address: 'Villa 6, Road 45, Saar',
    notes: null,
    created_at: '2026-03-04T07:58:00Z',
  }),
  customer({
    customer_id: 'cus_Ht2gC4by', business_id: B.north,
    display_name: 'Hiroko Tanabe', customer_type: 'person',
    email: 'hiroko.tanabe@example.net', phone: '+81 3 4967 5510', country: 'JP',
    address: '2-14-8 Kitazawa\nSetagaya, Tokyo 155-0031',
    notes: 'Retired from the partnership. Kept for reference only.',
    status: 'archived',
    created_at: '2025-07-11T04:44:00Z', updated_at: '2026-03-15T06:02:00Z',
    updated_by_principal_id: ORG_PRINCIPALS.sami,
  }),
  customer({
    customer_id: 'cus_Ib4hD6cz', business_id: B.atlas,
    display_name: 'Idris Bakhsh', customer_type: 'person',
    email: 'idris.bakhsh@example.com', phone: '+973 3477 9928', country: 'BH',
    address: 'Building 77, Road 1219, Hamad Town',
    notes: 'Collects in person on Thursdays.',
    created_at: '2026-03-11T14:36:00Z',
  }),
  customer({
    customer_id: 'cus_Ev6jE8da', business_id: B.north,
    display_name: 'Elena Vasquez', customer_type: 'person',
    email: 'elena.vasquez@example.net', phone: '+34 91 496 4407', country: 'ES',
    address: 'Calle Mayor 51, 3ºB\n28013 Madrid',
    notes: null,
    created_at: '2026-03-18T10:50:00Z',
  }),
  customer({
    customer_id: 'cus_Oa8kF1eb', business_id: B.marina,
    display_name: 'Omar Al-Dosari', customer_type: 'person',
    email: null, phone: null, country: 'BH',
    address: null,
    notes: 'Walk-in. Only the name and the Business are recorded so far.',
    created_at: '2026-03-25T16:07:00Z',
  }),
  customer({
    customer_id: 'cus_Gw1mG3fc', business_id: B.atlas,
    display_name: 'Grace Wambui', customer_type: 'person',
    email: 'grace.wambui@example.com', phone: '+254 20 496 1123', country: 'KE',
    address: 'PO Box 4417\nNairobi',
    notes: null,
    created_at: '2026-04-01T08:14:00Z',
  }),
  customer({
    customer_id: 'cus_Fm3nH5gd', business_id: B.marina,
    display_name: 'Fahad Al-Mutawa', customer_type: 'person',
    email: 'fahad.almutawa@example.com', phone: '+965 2 496 8830', country: 'KW',
    address: 'Block 4, Street 12, Salmiya\nKuwait City',
    notes: 'Prefers Arabic correspondence.',
    created_at: '2026-04-07T11:26:00Z',
  }),
  customer({
    customer_id: 'cus_Sl5pJ7he', business_id: B.north,
    display_name: 'Sara Lindqvist', customer_type: 'person',
    email: 'sara.lindqvist@example.net', phone: '+46 8 496 2201', country: 'SE',
    address: 'Vasagatan 19\n111 20 Stockholm',
    notes: null,
    created_at: '2026-04-14T13:03:00Z',
  }),
  customer({
    customer_id: 'cus_Kb7qK9if', business_id: B.atlas,
    display_name: 'Kareem Boulos', customer_type: 'person',
    email: 'kareem.boulos@example.com', phone: '+971 4 496 7714', country: 'AE',
    address: 'Office 1204, Al Quoz\nDubai',
    notes: 'Handles both the Dubai and the Sharjah accounts.',
    created_at: '2026-04-21T06:39:00Z',
  }),
  customer({
    customer_id: 'cus_Wz9rL2jg', business_id: B.north,
    display_name: 'Wei Zhang', customer_type: 'person',
    email: 'wei.zhang@example.net', phone: '+86 21 4967 3302', country: 'CN',
    address: 'Room 806, 1200 Yan An Road\nShanghai 200040',
    notes: null,
    created_at: '2026-04-28T02:55:00Z',
  }),
]);
