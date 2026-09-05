/**
 * ===========================================================================================
 * THE BINDING. `docs/decisions/0027` · contract `confirmation-v1`, §theBinding.
 * ===========================================================================================
 *
 * A CONFIRMATION IS BOUND TO EXACTLY ONE OPERATION, ON EXACTLY ONE TARGET, WITH EXACTLY ONE SET OF
 * PARAMETERS, FOR EXACTLY ONE PRINCIPAL, ON EXACTLY ONE SESSION.
 *
 * HMAC-SHA-256 over `principal_id · session_id · action_id · canonical(parameters)`, keyed by a
 * Worker secret. The stored row is KEYED BY THAT HASH and holds nothing else that could identify
 * anything.
 *
 * ===========================================================================================
 * WHY A HASH RATHER THAN THE IDENTIFIERS THEMSELVES — two arguments, and the second is better
 * ===========================================================================================
 *
 * THE STORAGE ARGUMENT. The confirmation record lives in the control plane, which must hold no
 * tenant business data. A row recording "principal P may delete customer C" would put a tenant's
 * customer identifier in the one database that spans every Organization — the disclosure
 * `control-plane/0001_principal.sql` refused a whole column to prevent, and exactly what `0025`
 * Decision 5 forbids of the operator log.
 *
 * THE BETTER ARGUMENT: **SUBSTITUTION FAILS BY CONSTRUCTION RATHER THAN BY COMPARISON.**
 * Verification RECOMPUTES the hash from the incoming request and looks it up. A caller who
 * confirms "delete customer X" and submits "delete customer Y" produces a different hash, WHICH
 * SIMPLY DOES NOT FIND A ROW. There is no comparison step to get wrong, no field to forget, and no
 * code path where the check is skipped because the values "looked right". A design that stored the
 * target and compared it would be one forgotten `if` away from confirming everything.
 *
 * ===========================================================================================
 * THE CANONICAL SERIALISATION — the schema assigns this ruling to `core-agent` and this is it
 * ===========================================================================================
 *
 * `requestConfirmationInput.parameters`: *"Canonical serialisation for hashing is normative and
 * owed to core-agent: sorted keys, no insignificant whitespace, UTF-8. TWO CLIENTS PRODUCING
 * DIFFERENT BYTES FOR THE SAME PARAMETERS WOULD MAKE CONFIRMATIONS FAIL ON ONE PLATFORM AND NOT
 * THE OTHER, which is the same class of cross-client hazard as the KDF normalisation split."*
 *
 * **THE RULING, AND IT IS NARROWER THAN THE SCHEMA'S SENTENCE ON PURPOSE:**
 *
 *   1. A FLAT OBJECT. Keys are strings; values are **string, boolean or null**. **NESTED OBJECTS,
 *      ARRAYS AND NUMBERS ARE REFUSED**, not serialised.
 *   2. EVERY STRING MUST ALREADY BE IN UNICODE NFC. A string that is not is refused, not
 *      normalised.
 *   3. KEYS SORTED by UTF-16 code unit — JavaScript's default `Array.prototype.sort`, which is the
 *      one ordering every client's standard library agrees on without configuration.
 *   4. `JSON.stringify` PER VALUE, concatenated with delimiters that cannot occur in a key or in
 *      the encoded values. No whitespace anywhere.
 *
 * **WHY NESTING IS REFUSED RATHER THAN CANONICALISED, WHICH IS THE PART THAT MATTERS.** Canonical
 * JSON for arbitrary nested values is a specification in its own right — number formatting,
 * duplicate keys, Unicode escapes, surrogate handling — and every implementation of it that three
 * codebases write independently is three implementations that agree until they do not. THE HAZARD
 * THE SCHEMA NAMES IS EXACTLY THAT, so the answer is to make the space small enough that
 * disagreement is not possible rather than to specify agreement over a large one.
 *
 * ===========================================================================================
 * *** NUMBERS ARE REFUSED ENTIRELY, AND "JSON PRIMITIVE" WAS NOT A BYTE-LEVEL SPECIFICATION ***
 * ===========================================================================================
 *
 * An earlier version of this ruling admitted safe integers, on the reasoning that
 * `JSON.stringify` renders them deterministically. **THAT IS TRUE OF JAVASCRIPT AND IS NOT A
 * SPECIFICATION.** `1`, `1.0` and `1e0` are the same JSON number and three different byte strings;
 * a Swift client is under no obligation to render as JavaScript does, and floating-point
 * formatting differs across languages in the last digit.
 *
 * TWO CLIENTS WOULD THEN PRODUCE DIFFERENT BINDING HASHES FOR THE SAME CONFIRMATION, and the
 * failure would surface as *"this confirmation does not exist"* — **indistinguishable from
 * tampering**, on the one mechanism whose job is to tell those apart. It would present as
 * "confirmations fail on iPhone" and would be diagnosed as a client bug.
 *
 * A PARAMETER THAT REACHES A BINDING HASH IS AN IDENTIFIER FAR MORE OFTEN THAN AN ARITHMETIC
 * VALUE, so requiring numbers as strings costs a caller one pair of quotes and removes the
 * ambiguity completely. An operation that genuinely needs a number in its binding should say so
 * and get a specified format; it should not inherit one from whichever client wrote first.
 *
 * ===========================================================================================
 * *** STRINGS MUST ALREADY BE NFC, AND THIS IS ENFORCED RATHER THAN OBLIGED ***
 * ===========================================================================================
 *
 * THE SAME TEXT IN NFC AND NFD IS DIFFERENT BYTES. `credential-store.ts` already carries this
 * hazard for passwords (NFC) and identifiers (NFKC), and records that the choice is never obvious.
 * Without a stated normalisation the cross-client hazard returns here — and this time it is the
 * web client against `Dudo-Apple` rather than two spellings of one password.
 *
 * **IT IS REFUSED, NOT NORMALISED, AND THAT IS THE DELIBERATE PART.** Core could silently apply
 * NFC and make both spellings hash alike. It does not, because the binding would then cover a
 * value that is not the one the operation acts on: a caller could confirm one spelling and submit
 * another, and the two would agree at the hash and disagree at whatever the handler looks up.
 * Refusing keeps **the bytes that were confirmed identical to the bytes that are used**.
 *
 * AND NOTE HOW THIS DIFFERS FROM THE CREDENTIAL PRECEDENT, because the difference is the reason it
 * can be stronger. `credential-store.ts` says of NFC: *"Core cannot enforce this. It is a client
 * obligation, and that is stated rather than implied"* — true there, because the password is
 * consumed by the client's KDF and Core never sees it. **HERE CORE SEES THE VALUE**, so it can
 * check, and a rule that can be checked should never be left as an obligation.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import { detail, invalidArgument } from '../kernel/errors.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';

/**
 * The delimiter between the four components of the bound message.
 *
 * A NEWLINE, AND ITS SAFETY IS A PROPERTY OF THE COMPONENTS RATHER THAN A HOPE. `principal_id` and
 * `session_id` are base64url (`^[A-Za-z0-9_-]+$`), `action_id` matches
 * `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`, and the canonical parameter string is `JSON.stringify`
 * output in which every literal newline is escaped as `\n`. NONE OF THE FOUR CAN CONTAIN A RAW
 * NEWLINE, so no two distinct component tuples can produce one message.
 *
 * THAT PROPERTY IS ASSERTED RATHER THAN ASSUMED — see `assertComponentsAreDelimiterSafe`, which
 * runs on every binding rather than at load, because three of the four components are per-request.
 */
const COMPONENT_DELIMITER = '\n';

/** The domain label. Keeps this HMAC's message space disjoint from every other key use. */
const DOMAIN = 'dudo.confirmation.binding.v1';

export const MAX_PARAMETER_KEYS = 24;
export const MAX_PARAMETER_KEY_LENGTH = 64;
export const MAX_PARAMETER_VALUE_LENGTH = 512;

/**
 * What a confirmation may carry. Flat, primitive, bounded — and **no numbers**. See the header:
 * `1`, `1.0` and `1e0` are one JSON number and three byte strings, so a number in a binding hash
 * is a cross-client failure waiting for the second client. Numbers arrive as strings.
 */
export type ConfirmationParameterValue = string | boolean | null;
export type ConfirmationParameters = Readonly<Record<string, ConfirmationParameterValue>>;

/**
 * Validates and canonicalises the parameter object.
 *
 * IT VALIDATES AND CANONICALISES IN ONE PASS, DELIBERATELY. Two functions would be two places the
 * accepted set and the hashed set could drift, and a value that validation permitted but
 * canonicalisation dropped would be a parameter the human confirmed and the binding did not cover.
 */
export function canonicalizeParameters(parameters: unknown): Result<string> {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    return err(invalidArgument([detail('parameters', 'must_be_an_object')]));
  }
  const entries = Object.entries(parameters as Record<string, unknown>);
  if (entries.length > MAX_PARAMETER_KEYS) {
    return err(invalidArgument([detail('parameters', 'too_many_fields')]));
  }

  // SORTED BY UTF-16 CODE UNIT — `Array.prototype.sort`'s default on strings, which is the one
  // ordering every client's standard library agrees on with no locale, collator or configuration.
  // A locale-aware sort would order the same keys differently on two devices in two countries.
  const sorted = entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  const parts: string[] = [];
  for (const [key, value] of sorted) {
    if (key.length === 0 || key.length > MAX_PARAMETER_KEY_LENGTH) {
      return err(invalidArgument([detail(key, 'invalid_parameter_name')]));
    }
    if (value === null || typeof value === 'boolean') {
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_PARAMETER_VALUE_LENGTH) {
        return err(invalidArgument([detail(key, 'too_long')]));
      }
      // *** NFC, CHECKED AND NOT APPLIED. *** See the header: normalising here would make the
      // hashed bytes differ from the submitted bytes, so a caller could confirm one spelling and
      // submit another and have them agree at the hash. Refusing keeps what was confirmed
      // byte-identical to what is used, and — unlike the password case `credential-store.ts`
      // records — Core can see this value, so this is enforced rather than obliged.
      if (value.normalize('NFC') !== value) {
        return err(invalidArgument([detail(key, 'must_be_nfc')]));
      }
      parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
      continue;
    }
    // A NUMBER, a nested object, an array, `undefined`, a function or a symbol. REFUSED, not
    // serialised. Numbers are named in the token because they are the one refusal a caller will
    // find surprising, and the fix is one pair of quotes.
    return err(invalidArgument([detail(key, 'must_be_a_string_boolean_or_null')]));
  }

  // `{` and `}` and `,` are structural and cannot appear unescaped in a `JSON.stringify` key or
  // value, so this string parses back to the same object and no two distinct objects produce it.
  return ok(`{${parts.join(',')}}`);
}

export class BindingComponentUnsafeError extends Error {
  constructor(component: string) {
    super(
      `A confirmation binding component (${component}) contained the delimiter. The four ` +
        'components are joined by a newline, and the grammar of each one — base64url ' +
        'identifiers, a dotted action id, and JSON-escaped canonical parameters — is what makes ' +
        'that unambiguous. A component carrying a raw newline would let two different bindings ' +
        'produce one message, which is a confirmation for operation A satisfying operation B.',
    );
    this.name = 'BindingComponentUnsafeError';
  }
}

/**
 * Thrown, not returned. NO CLIENT CAN CAUSE THIS: every component is either server-derived or has
 * already passed a grammar check by the time it arrives, so reaching it means Dudo's own code has
 * assembled a binding from something it did not validate.
 */
function assertComponentsAreDelimiterSafe(components: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(components)) {
    if (value.includes(COMPONENT_DELIMITER)) {
      throw new BindingComponentUnsafeError(name);
    }
  }
}

export type ConfirmationBindingInput = {
  /** Server-derived from a verified session credential. Never a request field. */
  readonly principalId: string;
  /**
   * The session the confirmation was obtained on.
   *
   * A CONFIRMATION OBTAINED IN ONE SESSION MUST NOT BE SPENDABLE IN ANOTHER. Otherwise a principal
   * logged in on two devices — or an attacker holding a second, stolen session for the same
   * principal — could ride a confirmation the legitimate user produced. Binding to the session
   * makes the confirmation DIE WITH IT, including at revocation.
   */
  readonly sessionId: string;
  readonly actionId: string;
  /** Already canonicalised by `canonicalizeParameters`. */
  readonly canonicalParameters: string;
};

export type ConfirmationBinder = {
  /** The base64url HMAC that is both the storage key and the verification. */
  bind(input: ConfirmationBindingInput): Promise<string>;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Uses WebCrypto, a platform global in Workers and in Node. No Cloudflare type is named, so this
 * file stays out of the adapter exception in `CLOUDFLARE_STANDARD.md` §2.
 *
 * THE LOCALE IS DELIBERATELY NOT AN INPUT. `0027`: it changes nothing about what will happen, and
 * binding it would refuse a confirmation from a user who switched language between the challenge
 * and the submission — a refusal with no security content. `theBinding` covers principal, session,
 * action and parameters, and locale is none of those.
 */
export async function createConfirmationBinder(
  signingKey: CryptoBytes,
): Promise<ConfirmationBinder> {
  if (signingKey.length < 32) {
    // Refuse a short key rather than accept one. This key is the only thing standing between a
    // caller and a binding it computed itself — and a forged binding is a confirmation for an
    // operation no human ever saw a statement for.
    throw new Error('The confirmation signing key must be at least 32 bytes.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    signingKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const encoder = new TextEncoder();

  return {
    async bind(input: ConfirmationBindingInput): Promise<string> {
      assertComponentsAreDelimiterSafe({
        principalId: input.principalId,
        sessionId: input.sessionId,
        actionId: input.actionId,
        canonicalParameters: input.canonicalParameters,
      });
      const message = [
        DOMAIN,
        input.principalId,
        input.sessionId,
        input.actionId,
        input.canonicalParameters,
      ].join(COMPONENT_DELIMITER);
      const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
      return toBase64Url(new Uint8Array(signature));
    },
  };
}
