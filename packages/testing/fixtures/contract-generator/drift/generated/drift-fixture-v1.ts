/**
 * *** DELIBERATELY STALE. DO NOT REGENERATE THIS FILE AND DO NOT "FIX" IT. ***
 *
 * This is the known-failing input for `generate-types.mjs --check`
 * (`docs/decisions/0037` requirement 3, `.claude/rules/workflow.md` §11a).
 *
 * It is what a correct generation of `drift-fixture-v1.schema.json` USED to look like, with three
 * differences planted in it. `--self-test` runs the drift check over this directory and FAILS IF
 * THE CHECK PASSES — so if someone regenerates this file, the self-test goes green forever and
 * stops being able to tell a working drift check from a broken one.
 *
 * THE THREE PLANTED DIFFERENCES, each a real drift mode rather than a typo:
 *
 *   1. A RENAMED FIELD.       `token` here; the schema says `token` is required and this file
 *                             calls it `echo_token`. This is `0034` exactly: the client shipped
 *                             one name and the contract published another.
 *   2. A WIDENED TYPE.        `mode` is `string` here; the schema declares an enum of two
 *                             members. A widened type compiles on both sides and silently accepts
 *                             a value the server refuses.
 *   3. A DROPPED OPERATION.   No `FixtureEchoError` and no `FixtureEchoPermission`. The contract
 *                             declares both; a generation that lost them would leave a consumer
 *                             hand-writing the error union again, which is the defect 0037 exists
 *                             to remove.
 *
 * Each is a difference the check must catch. If a future change to the generator makes only ONE
 * of them detectable, the self-test still passes — so a reader strengthening this fixture should
 * split it into three rather than assume one covers the others.
 */

export type EchoToken = string;
export type EchoCount = number;
export type EchoMode = string;
export type EchoLabelOrNull = string | null;
export type EchoInput = {
  readonly echo_token: EchoToken;
  readonly mode?: EchoMode;
  readonly count?: EchoCount;
};
export type EchoOutput = {
  readonly tokens: ReadonlyArray<EchoToken>;
  readonly label: EchoLabelOrNull;
};
