import { NotBuiltYet } from '@/components/NotBuiltYet';

/**
 * The console's home section.
 *
 * `platform-operator-v1` calls `platform.organizations.list` "the console's home
 * screen and the only way an operator discovers what exists", which is why this
 * is the default route rather than a dashboard. There is no dashboard: a
 * dashboard's job is to summarise, and every number worth summarising here —
 * customer counts, activity, usage — is a tenant read behind `whereWithTenant`.
 * The contract says so directly: "a 'how many customers does this Organization
 * have' column is how a console acquires cross-tenant reach one convenient
 * number at a time."
 */
export function Organizations() {
  return (
    <NotBuiltYet
      title="Organizations"
      purpose={
        <>
          Enumerating the Organizations on the platform — identifiers and status from the control
          plane — and onboarding new ones. No customer records, no counts and no activity: each of
          those is a tenant read, and a platform operator is structurally incapable of making one
          (<span className="whitespace-nowrap">ADR 0024</span>).
        </>
      }
      contract="packages/contracts/core/platform/platform-operator-v1.contract.yaml (platform.organizations.list) · organization-onboarding-v1.contract.yaml (platform.organizations.create)"
      contractStatus="Both proposed. Neither is accepted, so nothing may be built against them yet."
      blockedOn={[
        'Team Lead acceptance of both contracts.',
        'PO-1 — the platform-operator action log is a new control-plane object with no decision record, and the contract states this blocks implementation of every route in this class.',
        'PO-3 — the control plane has no name column for an Organization, so this list would be 22-character opaque identifiers. The contract calls that "not a usable administrative interface" and names the organization-structure slice as the fix.',
      ]}
    />
  );
}
