// A 128-bit content digest, computed once per node and never recomputed.
//
// It must be stable across runs, machines and browsers: two structurally identical trees
// have to produce the same digest every time, or the evaluation cache silently misses and
// a rebuilt model recomputes everything. That rules out anything seeded per process, and
// it rules out Web Crypto, which is async and cannot be called from a constructor.

const C1 = 0x239b961b, C2 = 0xab0e9789, C3 = 0x38b34ae5, C4 = 0xa1e38b93;

/**
 * Rotates a 32-bit word left.
 *
 * @param {number} x The word.
 * @param {number} r How many bits to rotate by.
 * @returns {number} The rotated word.
 */
function rotl(x, r) {
  return (x << r) | (x >>> (32 - r));
}

/**
 * Multiplies two 32-bit words, keeping the low bits.
 *
 * `Math.imul`, not `*`: a 32-bit product above 2^53 loses its low bits to the double, and
 * those low bits are most of the mixing.
 *
 * @param {number} a The left operand.
 * @param {number} b The right operand.
 * @returns {number} The low 32 bits of the product.
 */
function mul(a, b) {
  return Math.imul(a, b) | 0;
}

/**
 * The MurmurHash3 finalisation mix, which avalanches the remaining bits.
 *
 * @param {number} h A hash word.
 * @returns {number} The mixed word, unsigned.
 */
function fmix(h) {
  h ^= h >>> 16;
  h = mul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = mul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * MurmurHash3 x86_128 over a byte array.
 *
 * Chosen because it is 32-bit throughout, so it runs identically everywhere without BigInt.
 *
 * @param {Uint8Array} bytes The bytes to digest.
 * @returns {string} The digest, as 32 lowercase hex characters.
 */
export function digestBytes(bytes) {
  const len = bytes.length;
  const blocks = len >> 4;
  let h1 = 0, h2 = 0, h3 = 0, h4 = 0;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let i = 0; i < blocks; i++) {
    const o = i << 4;
    let k1 = view.getUint32(o, true);
    let k2 = view.getUint32(o + 4, true);
    let k3 = view.getUint32(o + 8, true);
    let k4 = view.getUint32(o + 12, true);

    k1 = mul(k1, C1); k1 = rotl(k1, 15); k1 = mul(k1, C2); h1 ^= k1;
    h1 = rotl(h1, 19); h1 = (h1 + h2) | 0; h1 = (mul(h1, 5) + 0x561ccd1b) | 0;

    k2 = mul(k2, C2); k2 = rotl(k2, 16); k2 = mul(k2, C3); h2 ^= k2;
    h2 = rotl(h2, 17); h2 = (h2 + h3) | 0; h2 = (mul(h2, 5) + 0x0bcaa747) | 0;

    k3 = mul(k3, C3); k3 = rotl(k3, 17); k3 = mul(k3, C4); h3 ^= k3;
    h3 = rotl(h3, 15); h3 = (h3 + h4) | 0; h3 = (mul(h3, 5) + 0x96cd1c35) | 0;

    k4 = mul(k4, C4); k4 = rotl(k4, 18); k4 = mul(k4, C1); h4 ^= k4;
    h4 = rotl(h4, 13); h4 = (h4 + h1) | 0; h4 = (mul(h4, 5) + 0x32ac3b17) | 0;
  }

  // The trailing bytes that did not fill a 16-byte block, folded in a word at a time. The
  // fallthrough shape is MurmurHash3's own; departing from it changes every digest.
  let k1 = 0, k2 = 0, k3 = 0, k4 = 0;
  const tail = blocks << 4;
  const rem = len & 15;

  if (rem >= 15) k4 ^= bytes[tail + 14] << 16;
  if (rem >= 14) k4 ^= bytes[tail + 13] << 8;
  if (rem >= 13) k4 ^= bytes[tail + 12];
  if (rem >= 13) { k4 = mul(k4, C4); k4 = rotl(k4, 18); k4 = mul(k4, C1); h4 ^= k4; }

  if (rem >= 12) k3 ^= bytes[tail + 11] << 24;
  if (rem >= 11) k3 ^= bytes[tail + 10] << 16;
  if (rem >= 10) k3 ^= bytes[tail + 9] << 8;
  if (rem >= 9) k3 ^= bytes[tail + 8];
  if (rem >= 9) { k3 = mul(k3, C3); k3 = rotl(k3, 17); k3 = mul(k3, C4); h3 ^= k3; }

  if (rem >= 8) k2 ^= bytes[tail + 7] << 24;
  if (rem >= 7) k2 ^= bytes[tail + 6] << 16;
  if (rem >= 6) k2 ^= bytes[tail + 5] << 8;
  if (rem >= 5) k2 ^= bytes[tail + 4];
  if (rem >= 5) { k2 = mul(k2, C2); k2 = rotl(k2, 16); k2 = mul(k2, C3); h2 ^= k2; }

  if (rem >= 4) k1 ^= bytes[tail + 3] << 24;
  if (rem >= 3) k1 ^= bytes[tail + 2] << 16;
  if (rem >= 2) k1 ^= bytes[tail + 1] << 8;
  if (rem >= 1) k1 ^= bytes[tail];
  if (rem >= 1) { k1 = mul(k1, C1); k1 = rotl(k1, 15); k1 = mul(k1, C2); h1 ^= k1; }

  h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len;
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;
  h1 = fmix(h1); h2 = fmix(h2); h3 = fmix(h3); h4 = fmix(h4);
  h1 = (h1 + h2) | 0; h1 = (h1 + h3) | 0; h1 = (h1 + h4) | 0;
  h2 = (h2 + h1) | 0; h3 = (h3 + h1) | 0; h4 = (h4 + h1) | 0;

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
    .map((w) => w.toString(16).padStart(8, '0'))
    .join('');
}

/**
 * Accumulates the canonical byte encoding of a node's payload.
 *
 * Every method returns the writer, so an encoding reads as one chain.
 *
 * Numbers go in as their IEEE-754 bits rather than as text. `toString` would collapse
 * values that are genuinely different (-0 and 0) and round others, so two distinct models
 * could share a digest and one would be served the other's geometry from the cache.
 */
export class DigestWriter {
  /** @type {Uint8Array[]} The pieces written so far, joined only at the end. */
  #parts = [];

  /** @type {number} Total length of `#parts`, tracked to size the buffer once. */
  #length = 0;

  /**
   * @param {Uint8Array} bytes The piece to append.
   * @returns {void}
   */
  #push(bytes) {
    this.#parts.push(bytes);
    this.#length += bytes.length;
  }

  /**
   * Writes a length-prefixed UTF-8 string, so `"ab" + "c"` cannot encode as `"a" + "bc"`.
   *
   * @param {string} value The string.
   * @returns {this} This writer.
   */
  string(value) {
    const bytes = new TextEncoder().encode(value);
    this.int(bytes.length);
    this.#push(bytes);
    return this;
  }

  /**
   * @param {number} value Coerced to a 32-bit integer.
   * @returns {this} This writer.
   */
  int(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value | 0, true);
    this.#push(bytes);
    return this;
  }

  /**
   * Writes a double as its IEEE-754 bits, normalising -0 to 0 so the two agree.
   *
   * @param {number} value The number.
   * @returns {this} This writer.
   */
  number(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value === 0 ? 0 : value, true);
    this.#push(bytes);
    return this;
  }

  /**
   * @param {ReadonlyArray<number>} values The numbers, written length-prefixed.
   * @returns {this} This writer.
   */
  numbers(values) {
    this.int(values.length);
    for (const value of values) this.number(value);
    return this;
  }

  /**
   * @param {boolean} value The flag.
   * @returns {this} This writer.
   */
  bool(value) {
    return this.int(value ? 1 : 0);
  }

  /**
   * Folds in a child's digest instead of walking its subtree, which is what keeps digest
   * computation O(1) per node rather than O(nodes) per node.
   *
   * @param {string} hex The child's digest.
   * @returns {this} This writer.
   */
  digest(hex) {
    return this.string(hex);
  }

  /**
   * @returns {string} The digest of everything written, as 32 lowercase hex characters.
   */
  finish() {
    const out = new Uint8Array(this.#length);
    let offset = 0;
    for (const part of this.#parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return digestBytes(out);
  }
}
