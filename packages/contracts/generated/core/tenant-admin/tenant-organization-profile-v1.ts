/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/core/tenant-admin/tenant-organization-profile-v1.schema.json
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
 * Contract:  *** status `proposed` — NOT ACCEPTED. ***
 *
 *            THE SOURCE CONTRACT IS NOT ACCEPTED, SO NOTHING BELOW IS AGREED. Types may
 *            change shape without a version bump, and ANY `*Permission` CONSTANT BELOW
 *            NAMES A PERMISSION THAT MAY NOT EXIST: docs/decisions/0007 rule 4 — a
 *            permission does not exist until it is in packages/contracts/registries/
 *            permission-catalog.yaml. Importing the name neither creates nor grants it,
 *            and a route gated on it will refuse every caller under deny-by-default.
 *            Build against this only if you are prepared to rewrite when it is accepted.
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */

import type { ErrorEnvelope } from '../../common/error-envelope.ts';
import type { RegistrationRecord } from '../platform/organization-identity-v1.ts';

export type ErrorResponse = ErrorEnvelope;

export type OrganizationDisplayName = string | null;

export type LegalName = string | null;

export type ContactEmail = string | null;

export type ContactPhone = string | null;

export type LanguageTag = 'en' | 'ar';

export type Timezone = string;

export type RegionalSettings = {
  readonly language: LanguageTag;
  readonly timezone: Timezone;
  readonly country: string | null;
  readonly currency: string | null;
  readonly week_starts_on: 'saturday' | 'sunday' | 'monday';
};

export type RegistrationSubmission = {
  readonly state: 'not_recorded' | 'not_applicable' | 'recorded';
  readonly number?: string | null;
};

export type GetProfileOutput = {
  readonly display_name: OrganizationDisplayName;
  readonly legal_name: LegalName;
  readonly contact_email: ContactEmail;
  readonly contact_phone: ContactPhone;
  readonly regional: RegionalSettings;
  readonly commercial_registration: RegistrationRecord;
  readonly vat_registration: RegistrationRecord;
};

export type UpdateProfileInput = {
  readonly display_name?: OrganizationDisplayName;
  readonly legal_name?: LegalName;
  readonly contact_email?: ContactEmail;
  readonly contact_phone?: ContactPhone;
  readonly regional?: RegionalSettings;
  readonly commercial_registration?: RegistrationSubmission;
  readonly vat_registration?: RegistrationSubmission;
};

export type UpdateProfileOutput = GetProfileOutput;


export type TenantOrganizationProfileGetError = 'unauthenticated' | 'forbidden' | 'rate_limited' | 'internal' | 'unavailable' | 'timeout';
export const TenantOrganizationProfileGetPermission = 'core.organization.read' as const;

export type TenantOrganizationProfileUpdateError = 'invalid_argument' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'quota_exceeded' | 'internal' | 'unavailable' | 'timeout';
export const TenantOrganizationProfileUpdatePermission = 'core.organization.update' as const;
