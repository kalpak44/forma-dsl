/**
 * A 128-bit content digest, computed once per node and never recomputed.
 *
 * It must be stable across runs, machines and browsers: two structurally identical trees have
 * to produce the same digest every time, or the evaluation cache silently misses and a
 * rebuilt model recomputes everything. That rules out anything seeded per process, and it
 * rules out Web Crypto, which is async and cannot be called from a constructor.
 */

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
 * Wraps a number to a signed 32-bit integer, the way the algorithm's additions are defined.
 *
 * `Math.imul(x, 1)` rather than `x | 0`: the two are identical — both coerce through
 * ToInt32 — but this one says *wrap*, which is what MurmurHash means here. `Math.trunc` is
 * emphatically not a substitute: it drops the fraction without wrapping, so `2**31 + 5`
 * stays positive instead of becoming negative, and every digest downstream changes.
 *
 * @param {number} x The value to wrap.
 * @returns {number} The low 32 bits, signed.
 */
function int32(x) {
  return Math.imul(x, 1);
}

/**
 * Multiplies two 32-bit words, keeping the low bits.
 *
 * `Math.imul`, not `*`: a 32-bit product above 2^53 loses its low bits to the double, and
 * those low bits are most of the mixing. It is also already defined to return a signed
 * 32-bit result, so nothing here has to wrap it again.
 *
 * @param {number} a The left operand.
 * @param {number} b The right operand.
 * @returns {number} The low 32 bits of the product.
 */
function mul(a, b) {
  return Math.imul(a, b);
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
 * Packs the bytes after the last whole block into four words, little-endian.
 *
 * Byte `i` of the tail belongs to word `i >> 2` at shift `(i & 3) * 8` — which is what
 * MurmurHash3's fallthrough spells out one case at a time. The arithmetic is identical;
 * only the shape differs, and the digests it produces are asserted to be unchanged.
 *
 * @param {Uint8Array} bytes The whole input.
 * @param {number} tail Offset of the first trailing byte.
 * @param {number} rem How many trailing bytes there are, 0 to 15.
 * @returns {number[]} The four words.
 */
function foldTail(bytes, tail, rem) {
  const k = [0, 0, 0, 0];
  for (let i = 0; i < rem; i++) {
    k[i >> 2] ^= bytes[tail + i] << ((i & 3) * 8);
  }
  return k;
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
    h1 = rotl(h1, 19); h1 = int32(h1 + h2); h1 = int32(mul(h1, 5) + 0x561ccd1b);

    k2 = mul(k2, C2); k2 = rotl(k2, 16); k2 = mul(k2, C3); h2 ^= k2;
    h2 = rotl(h2, 17); h2 = int32(h2 + h3); h2 = int32(mul(h2, 5) + 0x0bcaa747);

    k3 = mul(k3, C3); k3 = rotl(k3, 17); k3 = mul(k3, C4); h3 ^= k3;
    h3 = rotl(h3, 15); h3 = int32(h3 + h4); h3 = int32(mul(h3, 5) + 0x96cd1c35);

    k4 = mul(k4, C4); k4 = rotl(k4, 18); k4 = mul(k4, C1); h4 ^= k4;
    h4 = rotl(h4, 13); h4 = int32(h4 + h1); h4 = int32(mul(h4, 5) + 0x32ac3b17);
  }

  // The trailing bytes that did not fill a 16-byte block, folded in a word at a time.
  const tail = blocks << 4;
  const rem = len & 15;
  const k = foldTail(bytes, tail, rem);

  // Each word is mixed only if the tail reached it: k1 from one byte, k2 from five, and so
  // on. That is MurmurHash3's own fallthrough, written as the condition it encodes.
  if (rem >= 1) { let x = mul(k[0], C1); x = rotl(x, 15); h1 ^= mul(x, C2); }
  if (rem >= 5) { let x = mul(k[1], C2); x = rotl(x, 16); h2 ^= mul(x, C3); }
  if (rem >= 9) { let x = mul(k[2], C3); x = rotl(x, 17); h3 ^= mul(x, C4); }
  if (rem >= 13) { let x = mul(k[3], C4); x = rotl(x, 18); h4 ^= mul(x, C1); }

  h1 ^= len; h2 ^= len; h3 ^= len; h4 ^= len;
  h1 = int32(h1 + h2); h1 = int32(h1 + h3); h1 = int32(h1 + h4);
  h2 = int32(h2 + h1); h3 = int32(h3 + h1); h4 = int32(h4 + h1);
  h1 = fmix(h1); h2 = fmix(h2); h3 = fmix(h3); h4 = fmix(h4);
  h1 = int32(h1 + h2); h1 = int32(h1 + h3); h1 = int32(h1 + h4);
  h2 = int32(h2 + h1); h3 = int32(h3 + h1); h4 = int32(h4 + h1);

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
    new DataView(bytes.buffer).setInt32(0, int32(value), true);
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
