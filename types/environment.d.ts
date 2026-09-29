/**
 * The globals `src/` is allowed to rely on.
 *
 * The library is meant to run unchanged in a browser and in Node, so it commits to neither
 * environment's type library — pulling in `DOM` or `@types/node` here would let a
 * `window.` or a `process.` compile cleanly and then fail in the other runtime.
 *
 * These are the few globals both actually provide. The list is deliberately the same one
 * the ESLint config permits for `src/`, so the two agree on what "runs anywhere" means.
 *
 * Kept outside `src/` so it is not published: an ambient global declaration in a package's
 * own types leaks into every consumer's compilation and would clash with their `lib.dom`.
 */

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  readonly encoding: string;
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

declare const console: {
  log(...data: unknown[]): void;
  warn(...data: unknown[]): void;
  error(...data: unknown[]): void;
};
