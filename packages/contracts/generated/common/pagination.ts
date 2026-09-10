/**
 * GENERATED FILE — DO NOT EDIT. Your changes will be overwritten.
 *
 * Source:    packages/contracts/common/pagination.schema.json
 * Generator: packages/contracts/generator/generate-types.mjs (docs/decisions/0037)
 * Contract:  NONE — this is a shared schema with no `*.contract.yaml` beside it, so it
 *            declares no status. That is expected for `common/` and `registries/`.
 *
 * Consumers import these types and NEVER re-declare them (0037 requirement 2). A hand-written
 * type that restates a generated one is the defect 0037 exists to remove, arriving one layer up.
 *
 * These are COMPILE-TIME types. A generated type says what the contract promises; it does not
 * check what arrived. Runtime validation on the server is Core's and is not made optional by a
 * client having good types.
 */

export type Cursor = string;

export type PageSize = number;

export type NextCursor = string | null;

export type CollectionEnvelope<T> = {
  readonly data: ReadonlyArray<T>;
  readonly next_cursor: NextCursor;
};
