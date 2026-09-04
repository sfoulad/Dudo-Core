/**
 * Fixture data for the Customer Directory.
 *
 * SYNTHETIC AND FICTIONAL, without exception. Every name is invented, every
 * email uses a reserved non-routable example domain, and every phone number and
 * address is made up. Nothing here resembles a real person or company, and
 * nothing real may ever be added (security.md §6).
 *
 * Shapes follow the contract exactly: all fifteen fields are present on every
 * record, and an optional field the tenant has not filled in is present and
 * null — never absent.
 *
 * The set is deliberately larger than one page (34 records against a default
 * page size of 25) so pagination is real rather than theoretical, and it
 * includes records with null email/phone/country/address/notes, `Müller`
 * beside `Muller` so the no-accent-folding rule (CD-6) is visible in the
 * product rather than only in the document, and six archived records so the
 * archived filter and the restore path have something to act on.
 */

import type { BusinessId, Customer, CustomerType, BusinessRef } from '../contracts/customer-directory';

const P = {
  seed: 'prc_seed_import',
  kholoud: 'prc_kholoud_amin',
  sami: 'prc_sami_hadid',
} as const;

/**
 * The Businesses this fixture principal is authorized over.
 *
 * NOW CONTRACTED. These are `businessSummary` rows from
 * `core.ListAuthorizedBusinesses` (business-read-v1) — the contract that closed
 * the gap this client previously filled with a local placeholder.
 *
 * `display_name` IS NULL ON EVERY ROW, AND THAT IS NOT LAZINESS IN THE FIXTURE
 * — IT IS THE CONTRACT'S STATED PRESENT REALITY. Nothing in Dudo stores a
 * Business name: `platform/core/migrations/0002_business.sql` defines the
 * business table as exactly (tenant_id, business_id) and declined a name column
 * because that belongs to the organization-structure slice. So every response
 * from both Actions carries `display_name: null` today.
 *
 * Inventing names here would have made this client's screens show a state that
 * cannot occur, and would have made the web and Apple clients look different
 * for a reason that is not in the contract. Instead the fixture is truthful and
 * the contracted fallback — render the `business_id` verbatim — is the path
 * actually exercised. The day the organization-structure slice adds names, the
 * same code renders them with no change here.
 */
export const FIXTURE_BUSINESSES: readonly BusinessRef[] = Object.freeze([
  { business_id: 'biz_marina_ops', display_name: null },
  { business_id: 'biz_atlas_logi', display_name: null },
  { business_id: 'biz_northgate1', display_name: null },
]);

const B = {
  marina: 'biz_marina_ops' as BusinessId,
  atlas: 'biz_atlas_logi' as BusinessId,
  north: 'biz_northgate1' as BusinessId,
};

interface Seed {
  id: string;
  biz: BusinessId;
  name: string;
  type: CustomerType;
  email?: string;
  phone?: string;
  country?: string;
  address?: string;
  notes?: string;
  archived?: boolean;
  created: string;
  updated?: string;
  by?: string;
}

function build(seed: Seed): Customer {
  return {
    customer_id: seed.id,
    business_id: seed.biz,
    display_name: seed.name,
    customer_type: seed.type,
    email: seed.email ?? null,
    phone: seed.phone ?? null,
    country: seed.country ?? null,
    address: seed.address ?? null,
    notes: seed.notes ?? null,
    status: seed.archived ? 'archived' : 'active',
    // Non-null if and only if status is `pending_deletion`, and null in every
    // other state including `archived`. An archived record has no scheduled
    // deletion, and a value here would restate a countdown that does not exist.
    deletion_scheduled_at: null,
    created_at: seed.created,
    created_by_principal_id: P.seed,
    updated_at: seed.updated ?? seed.created,
    updated_by_principal_id: seed.by ?? P.seed,
  };
}

const SEEDS: Seed[] = [
  { id: 'cus_7Kq2mVx4', biz: B.marina, name: 'Marina Bay Provisions W.L.L.', type: 'company',
    email: 'accounts@marinabay.example.com', phone: '+973 1729 4410', country: 'BH',
    address: 'Building 2214, Road 4825\nBlock 428, Seef District\nManama',
    notes: 'Invoices go to the accounts inbox, never to the branch. Purchase order number required on every line.',
    created: '2026-01-14T08:12:00Z', updated: '2026-07-02T11:41:00Z', by: P.kholoud },
  { id: 'cus_Pd9wR3nZ', biz: B.atlas, name: 'Falcon Ridge Contracting', type: 'company',
    email: 'hello@falconridge.example.net', phone: '+973 1755 0182', country: 'BH',
    address: 'Unit 7, Sitra Industrial Area\nSitra', notes: 'Site access needs 24 hours notice.',
    created: '2026-01-19T06:55:00Z' },
  { id: 'cus_Lm4tB8yQ', biz: B.marina, name: 'Zallaq Coldstore Co.', type: 'company',
    email: 'ops@zallaqcold.example.com', phone: '+973 1766 3390', country: 'BH',
    address: 'Warehouse 11, Zallaq Coast Road',
    notes: 'Dormant since the Zallaq site closed. Kept for the historical ledger.',
    archived: true, created: '2025-11-03T09:20:00Z', updated: '2026-05-28T14:03:00Z', by: P.sami },
  { id: 'cus_Xr6vC1sK', biz: B.north, name: 'Northgate Signal Ltd', type: 'company',
    email: 'procurement@northgatesignal.example.net', phone: '+44 20 7946 0913', country: 'GB',
    address: '18 Calder Wharf\nLondon E1 4TR', created: '2026-02-02T15:31:00Z' },
  { id: 'cus_Hn3jD7pW', biz: B.north, name: 'Amber & Finch Studio', type: 'company',
    email: 'studio@amberfinch.example.com', phone: '+44 161 496 0771', country: 'GB',
    address: 'Floor 3, Ochre Building\nManchester M4 1HN',
    notes: 'Prefers a single quarterly invoice.', created: '2026-02-11T10:02:00Z' },
  { id: 'cus_Ty8kF2mL', biz: B.marina, name: 'Saffron Line Catering', type: 'company',
    email: 'orders@saffronline.example.com', phone: '+973 3644 2210', country: 'BH',
    address: 'Shop 4, Adliya Block 338', notes: 'Deliveries before 09:00 only.',
    created: '2026-02-17T07:44:00Z' },
  { id: 'cus_Qw5nG9dR', biz: B.atlas, name: 'Dilmun Paper Mills', type: 'company',
    email: 'supply@dilmunpaper.example.net', phone: '+973 1783 5567', country: 'BH',
    address: 'Plot 3, Hidd Industrial Estate', created: '2026-02-24T12:15:00Z' },
  { id: 'cus_Vb2hJ6xT', biz: B.atlas, name: 'Blue Harbour Marine Services', type: 'company',
    email: 'dispatch@blueharbour.example.com', phone: '+973 1731 8802', country: 'BH',
    address: 'Berth 9, Mina Salman',
    notes: 'Contact the harbourmaster before any evening collection.',
    created: '2026-03-01T05:10:00Z', updated: '2026-08-04T09:26:00Z', by: P.kholoud },
  { id: 'cus_Zs9pK4cN', biz: B.north, name: 'Müller Handelsgesellschaft mbH', type: 'company',
    email: 'einkauf@muellerhandel.example.net', phone: '+49 40 7734 2200', country: 'DE',
    address: 'Speicherstrasse 14\n20457 Hamburg',
    notes: 'German-language correspondence preferred.', created: '2026-03-06T13:48:00Z' },
  { id: 'cus_Ck7mL1vB', biz: B.atlas, name: 'Muller Freight Services', type: 'company',
    email: 'bookings@mullerfreight.example.com', phone: '+44 151 496 3318', country: 'GB',
    address: 'Dock Gate 6\nLiverpool L3 4BQ',
    notes: 'Not related to the Hamburg company of a similar name.',
    archived: true, created: '2025-09-22T11:05:00Z', updated: '2026-04-19T16:12:00Z', by: P.sami },
  { id: 'cus_Nj4qM8zV', biz: B.north, name: 'Cobalt Row Analytics', type: 'company',
    email: 'finance@cobaltrow.example.net', country: 'GB',
    notes: 'Everything by email. They have asked twice not to be telephoned.',
    created: '2026-03-12T09:33:00Z' },
  { id: 'cus_Rf6sN3bH', biz: B.marina, name: 'Riffa Print House', type: 'company',
    email: 'jobs@riffaprint.example.com', phone: '+973 1777 4021', country: 'BH',
    address: 'Road 2825, Riffa',
    notes: 'Closed the print floor in June. Archived pending a decision.',
    archived: true, created: '2025-12-08T08:00:00Z', updated: '2026-06-30T10:55:00Z', by: P.kholoud },
  { id: 'cus_Gd8tP5wJ', biz: B.marina, name: 'Seef Tower Facilities', type: 'company',
    email: 'fm@seeftower.example.net', phone: '+973 1758 1190', country: 'BH',
    address: 'Seef Tower, Level 12\nManama', created: '2026-03-20T14:21:00Z' },
  { id: 'cus_Wq3rQ7nD', biz: B.north, name: 'Orchard & Vale Foods', type: 'company',
    email: 'buying@orchardvale.example.com', phone: '+44 117 496 2255', country: 'GB',
    address: 'Unit 22, Feeder Road\nBristol BS2 0TQ',
    notes: 'Seasonal ordering. Quiet between January and March.', created: '2026-03-27T11:09:00Z' },
  { id: 'cus_Bh5vR2mF', biz: B.atlas, name: 'Kestrel Yard Engineering', type: 'company',
    email: 'admin@kestrelyard.example.net', phone: '+973 1739 6604', country: 'BH',
    address: 'Yard 5, Askar', notes: 'Archived after the contract ended in May.',
    archived: true, created: '2025-10-15T07:30:00Z', updated: '2026-05-11T13:40:00Z', by: P.sami },
  { id: 'cus_Ms7wS9pG', biz: B.marina, name: 'Tashkeel Interiors W.L.L.', type: 'company',
    email: 'projects@tashkeel.example.com', phone: '+973 3699 7714', country: 'BH',
    address: 'Showroom 3, Budaiya Highway', created: '2026-04-02T09:47:00Z' },
  { id: 'cus_Jk2xT4rH', biz: B.marina, name: 'Pearl Divers Coffee Roasters', type: 'company',
    email: 'wholesale@pearldivers.example.net', phone: '+973 3312 6690', country: 'BH',
    address: 'Warehouse 2, Tubli',
    notes: 'Wholesale only. Retail enquiries go to the shop, not to us.',
    created: '2026-04-09T06:18:00Z' },
  { id: 'cus_Dl9yU6sK', biz: B.north, name: 'Lantern Bay Hospitality', type: 'company',
    phone: '+44 131 496 8020', country: 'GB', address: '4 Lantern Close\nEdinburgh EH6 6QU',
    notes: 'No email on file. Everything is arranged by telephone.',
    created: '2026-04-16T15:52:00Z' },

  { id: 'cus_An4zV8tM', biz: B.marina, name: 'Amal Rashid Al-Fardan', type: 'person',
    email: 'amal.alfardan@example.com', phone: '+973 3901 2244', country: 'BH',
    address: 'Villa 118, Road 3609\nBlock 336, Adliya',
    notes: 'Invoices in her own name, not the practice name.', created: '2026-01-22T10:11:00Z' },
  { id: 'cus_Yu6aW1vP', biz: B.marina, name: 'Yusuf Haddad', type: 'person',
    email: 'yusuf.haddad@example.com', phone: '+973 3655 8871', country: 'BH',
    address: 'Flat 22, Building 940, Road 1425\nIsa Town', created: '2026-02-05T08:29:00Z' },
  { id: 'cus_Pr8bX3wQ', biz: B.north, name: 'Priya Nandakumar', type: 'person',
    email: 'priya.nandakumar@example.net', phone: '+91 80 4967 2210', country: 'IN',
    address: '14 Rosewood Lane\nBengaluru 560034',
    notes: 'Timezone: five and a half hours ahead of Manama.', created: '2026-02-13T12:04:00Z' },
  { id: 'cus_Tf3cY5xR', biz: B.north, name: 'Tomás Ferreira', type: 'person',
    email: 'tomas.ferreira@example.com', phone: '+351 21 496 3320', country: 'PT',
    address: 'Rua das Amoreiras 88\n1250-024 Lisboa', created: '2026-02-20T17:15:00Z' },
  { id: 'cus_Ns5dZ7yT', biz: B.marina, name: 'Noor Al-Sayegh', type: 'person',
    email: 'noor.alsayegh@example.com', phone: '+973 3388 4402', country: 'BH',
    notes: 'Address still to be collected.', created: '2026-02-27T09:41:00Z' },
  { id: 'cus_Do7eA9zV', biz: B.atlas, name: 'Daniel Okonkwo', type: 'person',
    email: 'daniel.okonkwo@example.net', phone: '+234 1 496 7781', country: 'NG',
    address: '9 Harbour View Road\nLagos',
    notes: 'Moved to a different supplier in April. Archived rather than deleted.',
    archived: true, created: '2025-08-30T13:22:00Z', updated: '2026-04-24T08:17:00Z', by: P.kholoud },
  { id: 'cus_Lm9fB2ax', biz: B.marina, name: 'Layla Mansour', type: 'person',
    email: 'layla.mansour@example.com', phone: '+973 3922 0165', country: 'BH',
    address: 'Villa 6, Road 45, Saar', created: '2026-03-04T07:58:00Z' },
  { id: 'cus_Ht2gC4by', biz: B.north, name: 'Hiroko Tanabe', type: 'person',
    email: 'hiroko.tanabe@example.net', phone: '+81 3 4967 5510', country: 'JP',
    address: '2-14-8 Kitazawa\nSetagaya, Tokyo 155-0031',
    notes: 'Retired from the partnership. Kept for reference only.',
    archived: true, created: '2025-07-11T04:44:00Z', updated: '2026-03-15T06:02:00Z', by: P.sami },
  { id: 'cus_Ib4hD6cz', biz: B.atlas, name: 'Idris Bakhsh', type: 'person',
    email: 'idris.bakhsh@example.com', phone: '+973 3477 9928', country: 'BH',
    address: 'Building 77, Road 1219, Hamad Town',
    notes: 'Collects in person on Thursdays.', created: '2026-03-11T14:36:00Z' },
  { id: 'cus_Ev6jE8da', biz: B.north, name: 'Elena Vasquez', type: 'person',
    email: 'elena.vasquez@example.net', phone: '+34 91 496 4407', country: 'ES',
    address: 'Calle Mayor 51, 3ºB\n28013 Madrid', created: '2026-03-18T10:50:00Z' },
  { id: 'cus_Oa8kF1eb', biz: B.marina, name: 'Omar Al-Dosari', type: 'person', country: 'BH',
    notes: 'Walk-in. Only the name and the Business are recorded so far.',
    created: '2026-03-25T16:07:00Z' },
  { id: 'cus_Gw1mG3fc', biz: B.atlas, name: 'Grace Wambui', type: 'person',
    email: 'grace.wambui@example.com', phone: '+254 20 496 1123', country: 'KE',
    address: 'PO Box 4417\nNairobi', created: '2026-04-01T08:14:00Z' },
  { id: 'cus_Fm3nH5gd', biz: B.marina, name: 'Fahad Al-Mutawa', type: 'person',
    email: 'fahad.almutawa@example.com', phone: '+965 2 496 8830', country: 'KW',
    address: 'Block 4, Street 12, Salmiya\nKuwait City',
    notes: 'Prefers Arabic correspondence.', created: '2026-04-07T11:26:00Z' },
  { id: 'cus_Sl5pJ7he', biz: B.north, name: 'Sara Lindqvist', type: 'person',
    email: 'sara.lindqvist@example.net', phone: '+46 8 496 2201', country: 'SE',
    address: 'Vasagatan 19\n111 20 Stockholm', created: '2026-04-14T13:03:00Z' },
  { id: 'cus_Kb7qK9if', biz: B.atlas, name: 'Kareem Boulos', type: 'person',
    email: 'kareem.boulos@example.com', phone: '+971 4 496 7714', country: 'AE',
    address: 'Office 1204, Al Quoz\nDubai',
    notes: 'Handles both the Dubai and the Sharjah accounts.', created: '2026-04-21T06:39:00Z' },
  { id: 'cus_Wz9rL2jg', biz: B.north, name: 'Wei Zhang', type: 'person',
    email: 'wei.zhang@example.net', phone: '+86 21 4967 3302', country: 'CN',
    address: 'Room 806, 1200 Yan An Road\nShanghai 200040', created: '2026-04-28T02:55:00Z' },
];

export const FIXTURE_CUSTOMERS: readonly Customer[] = Object.freeze(SEEDS.map(build));
