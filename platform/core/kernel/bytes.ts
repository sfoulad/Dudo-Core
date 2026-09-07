/**
 * ===========================================================================================
 * `CryptoBytes` — the byte buffer type WebCrypto will actually accept.
 * ===========================================================================================
 *
 * WHY THIS EXISTS. TypeScript 5.7 made `Uint8Array` generic over its backing buffer, so the
 * bare `Uint8Array` now means `Uint8Array<ArrayBufferLike>` — and `ArrayBufferLike` includes
 * `SharedArrayBuffer`, which `BufferSource` does not. Every `crypto.subtle` call taking a bare
 * `Uint8Array` therefore stopped typechecking, in six files at once, on a codebase whose runtime
 * behaviour did not change by one instruction.
 *
 * ===========================================================================================
 * THIS IS A TYPES-ONLY CORRECTION AND THE CODE IT ANNOTATES WAS ALREADY RIGHT.
 * ===========================================================================================
 *
 * Every value it is applied to comes from `new Uint8Array(n)`, from `TextEncoder.encode`, or
 * from `new Uint8Array(arrayBuffer)`. All three are backed by a real `ArrayBuffer` at runtime,
 * always, and none of them can produce a `SharedArrayBuffer` view — Dudo never constructs one,
 * and a Worker isolate has no way to receive one.
 *
 * IT IS AN ALIAS AND NOT A CAST, AND THE DISTINCTION IS THE WHOLE POINT. There is no
 * `as unknown as`, no `@ts-expect-error` and no helper that launders a value through `any`. A
 * cast would silence the checker at the call site and would keep silencing it if someone later
 * passed something that genuinely was not `ArrayBuffer`-backed. This alias does the opposite: it
 * states the requirement in the signature, so a caller holding a `Uint8Array<ArrayBufferLike>`
 * gets an error at the boundary, which is where the question can actually be answered.
 *
 * WHERE TO USE IT: on a parameter, field or return type whose value is handed to
 * `crypto.subtle` — a key, a salt, a message, a signature. NOT on values that are only read,
 * compared or encoded. `constantTimeEquals` and `toBase64Url` take a bare `Uint8Array`
 * deliberately, because they work on any view and narrowing them would force callers to convert
 * for no reason.
 *
 * It lives in `kernel/` because `pagination/**` and `identity/**` both need it and neither may
 * depend on the other.
 */

export type CryptoBytes = Uint8Array<ArrayBuffer>;
