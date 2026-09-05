/**
 * ===========================================================================================
 * THE PLATFORM CURSOR. A position in the control plane's `organization` table, and nothing else.
 * ===========================================================================================
 *
 * `pagination/cursor.ts` is the platform's cursor implementation and it CANNOT BE USED HERE.
 * Every method on `CursorCodec` takes a `tenantId`, its payload carries a digest of that tenant,
 * and `TenantBoundCursorCodec` exists precisely so an Action can page without holding one.
 * A PLATFORM ROUTE HAS NO TENANT AT ALL, so there is no value to bind to and no honest thing to
 * pass. Supplying a placeholder would be a security check filled in with a constant, which is a
 * security check switched off quietly.
 *
 * The alternative — widening `CursorCodec` to make the tenant optional — is `0021`'s refused
 * shortcut in a smaller costume: an optional tenant on a shared primitive makes every existing
 * call site's guarantee conditional on which branch it took.
 *
 * SO THIS IS A SEPARATE, SMALLER CODEC WITH NO TENANT CONCEPT IN IT ANYWHERE. It reuses
 * `pagination/cursor.ts`'s three published constants — the rejection value, the maximum age and
 * the maximum length — rather than restating them, because two pagination floors that were meant
 * to be identical are two floors that will differ.
 *
 * ===========================================================================================
 * WHY IT IS SIGNED AT ALL, GIVEN THE CALLER MAY ALREADY ENUMERATE EVERYTHING
 * ===========================================================================================
 *
 * A caller reaching this holds `core.organization.list` and may page the whole table, so forging
 * a cursor grants it nothing it could not obtain by paging. THE SIGNATURE IS NOT THERE TO STOP AN
 * ESCALATION. It buys two narrower things:
 *
 *   1. THE CURSOR STAYS OPAQUE, which is what the contract's schema requires — "never
 *      constructed, parsed or modified by a client". An unsigned cursor is an invitation to
 *      construct one, and the first client that does becomes a consumer of the anchor's format.
 *   2. A MALFORMED VALUE IS REFUSED BEFORE IT REACHES THE DATABASE, so a junk cursor costs a
 *      400 and no read.
 *
 * IT ALSO BINDS THE PAGE SIZE, for `pagination/cursor.ts`'s reason: "a page 2 under different
 * filters is not page 2." Changing `page_size` mid-enumeration with the same cursor would skip or
 * repeat rows silently.
 *
 * ===========================================================================================
 * AND IT BINDS THE PRINCIPAL. `platform-operator-v1`'s corrected `$defs/cursor`:
 * "IT MUST NOT BE TRANSFERABLE BETWEEN OPERATORS, or one operator could resume another's
 * enumeration."
 * ===========================================================================================
 *
 * THE HONEST SCOPE OF THIS, BECAUSE IT IS NARROWER THAN IT SOUNDS. Any caller who can present a
 * cursor already holds `core.organization.list` and can page from the start, so a transferred
 * cursor discloses nothing that caller could not obtain in one more request. THIS IS NOT AN
 * ESCALATION AND IT IS NOT A CONFIDENTIALITY FIX.
 *
 * WHAT IT IS: a contract and an implementation agreeing. The rule is now normative in an accepted
 * contract, the cost of honouring it is one field and one comparison, and a quiet disagreement
 * between a published contract and the code is how `the422Rule` began — which shipped into a
 * client. The property is also the one that would matter first if a narrower platform role ever
 * held a filtered view of this collection.
 *
 * THE PRINCIPAL IS CARRIED AS A DIGEST, NEVER AS A VALUE — `pagination/cursor.ts`'s device and its
 * reason: "A cursor is base64url and a client can decode it." An operator's own principal
 * identifier is not a secret from that operator, but a cursor ends up in logs, in referrers and in
 * bug reports, and a digest salted with the signing key compares equal for the same principal
 * while revealing nothing to whoever finds it there.
 *
 * A MISMATCH RETURNS THE SAME `rejectedCursor()` AS EVERY OTHER FAILURE, so binding the principal
 * adds no new distinguishable case — an operator presenting another's cursor cannot tell that from
 * presenting an expired one.
 *
 * ===========================================================================================
 * IT SHARES `CURSOR_SIGNING_KEY`, AND THE DOMAIN SEPARATION IS EXPLICIT
 * ===========================================================================================
 *
 * The same judgement `identity/composition.ts` makes when the pre-auth bucketer shares
 * `IDENTITY_LOOKUP_KEY`: two HMACs may share a key when they can never be asked to sign the same
 * message. `pagination/cursor.ts` signs a base64url body with no prefix and digests `"d <value>"`;
 * this file signs `"dudo.platform.cursor.v1 <body>"`. The message spaces are disjoint by
 * construction, which is what domain separation means.
 *
 * The Team Lead may override this with a separate secret. It is a judgement call and it is
 * written down as one.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { CryptoBytes } from '../kernel/bytes.ts';
import { CURSOR_MAX_AGE_MS, CURSOR_MAX_LENGTH, rejectedCursor } from '../pagination/cursor.ts';

const CURSOR_VERSION = 1;
/** 32 bytes of HMAC-SHA-256 as unpadded base64url. Fixed, which is what lets it be a prefix. */
const SIGNATURE_LENGTH = 43;
/** The domain label. Its presence is what keeps this codec's messages disjoint from cursor.ts's. */
const DOMAIN = 'dudo.platform.cursor.v1 ';

/**
 * What a cursor is bound to. All three are compared on presentation; none is ever USED to build
 * the query, which is `pagination/cursor.ts` property 1 applied here — the anchor is a position,
 * and the other two are equality checks.
 *
 * A RECORD RATHER THAN THREE POSITIONAL ARGUMENTS, so that adding a fourth binding later cannot
 * silently reorder two `string` parameters at a call site. `encode(anchor, pageSize, principalId)`
 * and `encode(anchor, principalId, pageSize)` would both compile.
 */
export type PlatformCursorBinding = {
  /** The operator this cursor was issued to. Server-derived; carried as a digest, never a value. */
  readonly principalId: string;
  readonly pageSize: number;
};

export type PlatformCursorCodec = {
  /** The anchor is the LAST identifier of the page just returned. */
  encode(
    anchorOrganizationId: string,
    binding: PlatformCursorBinding,
    nowMs: number,
  ): Promise<string>;
  /**
   * Returns the anchor, or ONE rejection value.
   *
   * EVERY FAILURE RETURNS `rejectedCursor()`, which is a single constant expression with no
   * parameters — malformed, forged, expired, bound to a different page size, and ISSUED TO A
   * DIFFERENT OPERATOR are five causes and one answer. That is `pagination/cursor.ts`'s property 4,
   * kept structural rather than remembered: there is no branch here that produces a different
   * error and none that takes an argument, so the five cannot drift apart.
   */
  decode(
    cursor: string,
    binding: PlatformCursorBinding,
    nowMs: number,
  ): Promise<Result<string>>;
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array | undefined {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/** Length-independent comparison. Bails on length first because length is not a secret. */
function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left[i] ^ right[i];
  }
  return difference === 0;
}

/**
 * Uses WebCrypto, which is a platform global in Workers and in Node. No Cloudflare type is named,
 * so this file stays out of the adapter exception in `CLOUDFLARE_STANDARD.md` §2.
 */
export async function createPlatformCursorCodec(
  signingKey: CryptoBytes,
): Promise<PlatformCursorCodec> {
  if (signingKey.length < 32) {
    // Refuse a short key rather than accept one, exactly as `createCursorCodec` does.
    throw new Error('The platform cursor signing key must be at least 32 bytes.');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    signingKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const encoder = new TextEncoder();

  async function mac(message: string): Promise<Uint8Array> {
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${DOMAIN}${message}`));
    return new Uint8Array(signature);
  }

  /**
   * A short, salted digest. Comparable; not reversible into the value it stands for.
   *
   * The `'d '` prefix keeps digest messages disjoint from body signatures under the same key, so
   * a digest can never be mistaken for — or substituted with — a signature. Twelve bytes is 96
   * bits, far past what a comparison needs and short enough to keep the cursor well inside its
   * 512-character ceiling. Both choices are `pagination/cursor.ts`'s, deliberately unchanged.
   */
  async function digest(value: string): Promise<string> {
    const bytes = await mac(`d ${value}`);
    return toBase64Url(bytes.slice(0, 12));
  }

  return {
    async encode(
      anchorOrganizationId: string,
      binding: PlatformCursorBinding,
      nowMs: number,
    ): Promise<string> {
      const body = JSON.stringify({
        v: CURSOR_VERSION,
        a: anchorOrganizationId,
        p: binding.pageSize,
        // THE OPERATOR, AS A DIGEST. See the header: comparable, and worthless to whoever finds
        // this string in a log.
        o: await digest(binding.principalId),
        i: nowMs,
      });
      const bodyEncoded = toBase64Url(encoder.encode(body));
      const signature = toBase64Url(await mac(bodyEncoded));
      // SIGNATURE FIRST, NO SEPARATOR — the contract's cursor is a plain string with no delimiter
      // guaranteed to be absent from the body, so the two parts are split by the signature's
      // fixed width. The same shape `pagination/cursor.ts` uses, for the same reason.
      return `${signature}${bodyEncoded}`;
    },

    async decode(
      cursor: string,
      binding: PlatformCursorBinding,
      nowMs: number,
    ): Promise<Result<string>> {
      // Every `return err(rejectedCursor())` below is the SAME value. Do not specialise one.
      if (cursor.length <= SIGNATURE_LENGTH || cursor.length > CURSOR_MAX_LENGTH) {
        return err(rejectedCursor());
      }
      const presented = fromBase64Url(cursor.slice(0, SIGNATURE_LENGTH));
      if (presented === undefined) {
        return err(rejectedCursor());
      }
      const bodyEncoded = cursor.slice(SIGNATURE_LENGTH);
      // Verified BEFORE the body is parsed, so a forged cursor never reaches JSON.
      if (!equalBytes(presented, await mac(bodyEncoded))) {
        return err(rejectedCursor());
      }

      const bodyBytes = fromBase64Url(bodyEncoded);
      if (bodyBytes === undefined) {
        return err(rejectedCursor());
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(bodyBytes));
      } catch {
        return err(rejectedCursor());
      }
      if (typeof parsed !== 'object' || parsed === null) {
        return err(rejectedCursor());
      }
      const body = parsed as Record<string, unknown>;

      if (body.v !== CURSOR_VERSION || typeof body.a !== 'string' || typeof body.i !== 'number') {
        return err(rejectedCursor());
      }
      if (nowMs - body.i > CURSOR_MAX_AGE_MS || body.i > nowMs) {
        return err(rejectedCursor());
      }
      if (body.p !== binding.pageSize) {
        return err(rejectedCursor());
      }
      // ISSUED TO A DIFFERENT OPERATOR. COMPARED, never used: `binding.principalId` here is the
      // AUTHENTICATED operator, and the cursor's contribution is a yes or a no. There is no code
      // path that reads a principal out of a cursor, because none is in there to read.
      if (body.o !== (await digest(binding.principalId))) {
        return err(rejectedCursor());
      }
      return ok(body.a);
    },
  };
}
