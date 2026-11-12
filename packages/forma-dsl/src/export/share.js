/**
 * A document, and the param values chosen for it, packed into a string short enough to put
 * in a URL - and unpacked again.
 *
 * The editor is a static page with nowhere to store anything, so a shared model has to carry
 * itself. The payload is compressed before it is encoded: forma is repetitive text, and
 * deflate takes a typical document to about a third of what plain base64 would make of it,
 * which is the difference between a link a chat app keeps whole and one it truncates.
 *
 * The payload goes in the fragment, not the query string. A fragment is never sent to the
 * server, so its length is the browser's problem rather than the host's, and a model shared
 * this way is not written into anyone's access log.
 *
 * Shared by the editor, which makes and opens these links, and the MCP server, which makes
 * them for a model to hand to a person - one implementation, so the two cannot disagree on
 * the format.
 */

/** @import { ParameterValue, SharedDocument } from '../index.js' */

/**
 * What every payload starts with. A later format gets a new prefix, so a link made today
 * still opens - or is refused by name - after the format changes.
 */
const VERSION_PREFIX = 'v1.';

/**
 * How large an unpacked document may be before the link is refused.
 *
 * A link is untrusted input, and deflate expands: a few kilobytes of URL can inflate to
 * gigabytes. Far above any honest document - the worked examples are under five kilobytes.
 */
const MAX_UNPACKED_BYTES = 1024 * 1024;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encodes bytes as unpadded base64url.
 *
 * Written out rather than built on `btoa`, which takes a binary string and is one more
 * global this package would have to rely on in both runtimes.
 *
 * @param {Uint8Array} bytes The bytes.
 * @returns {string} The text, safe in a URL fragment as it stands.
 */
function toBase64Url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const remaining = bytes.length - i;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (remaining > 1) out += ALPHABET[(n >> 6) & 63];
    if (remaining > 2) out += ALPHABET[n & 63];
  }
  return out;
}

/**
 * Decodes unpadded base64url.
 *
 * @param {string} text The text.
 * @returns {Uint8Array} The bytes.
 * @throws {Error} If the text is not base64url.
 */
function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error('the link is damaged - it is not valid base64url');
  }
  const bytes = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) n = (n << 6) | (j < chunk.length ? ALPHABET.indexOf(chunk[j]) : 0);
    bytes[o++] = (n >> 16) & 255;
    if (chunk.length > 2) bytes[o++] = (n >> 8) & 255;
    if (chunk.length > 3) bytes[o++] = n & 255;
  }
  return bytes;
}

/**
 * Runs bytes through a compression stream and collects what comes out.
 *
 * To write is not awaited before reading: a stream applies backpressure, so a write larger
 * than its buffer only settles once the other end has been read.
 *
 * @param {CompressionStream | DecompressionStream} stream The transform.
 * @param {Uint8Array} bytes What to put in.
 * @param {number} limit How many bytes may come out before giving up.
 * @returns {Promise<Uint8Array>} What came out.
 * @throws {RangeError} If more than `limit` bytes come out.
 * @throws {TypeError} If the stream fails, which for inflating means damaged input.
 */
async function pump(stream, bytes, limit) {
  const writer = stream.writable.getWriter();
  // Their failures are the reader's to report; left unhandled they would be reported twice.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});

  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError(`the shared document is larger than ${limit} bytes, which no link should be`);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Packs a document into the payload of a share link.
 *
 * @param {SharedDocument} shared The document, and any param values chosen for it.
 * @returns {Promise<string>} The payload, to go after the `#` of the editor's URL.
 * @throws {TypeError} If `source` is not a string.
 */
export async function encodeShare(shared) {
  const { source, params } = shared;
  if (typeof source !== 'string') throw new TypeError('a shared document needs its source');

  // Short keys, because every byte of the payload is a byte of the link.
  const body = params && Object.keys(params).length ? { s: source, p: params } : { s: source };
  const json = new TextEncoder().encode(JSON.stringify(body));
  const packed = await pump(new CompressionStream('deflate-raw'), json, Infinity);
  return VERSION_PREFIX + toBase64Url(packed);
}

/**
 * Unpacks the payload of a share link.
 *
 * @param {string} payload The fragment, with or without its leading `#`.
 * @returns {Promise<SharedDocument>} The document, and any param values it was shared with.
 * @throws {Error} If the payload is not one this version made, or is damaged.
 */
export async function decodeShare(payload) {
  const text = payload.startsWith('#') ? payload.slice(1) : payload;
  if (!text.startsWith(VERSION_PREFIX)) {
    const version = /^v\d+\./.exec(text)?.[0].slice(0, -1);
    throw new Error(version
      ? `this link was made by a newer version of forma (format ${version})`
      : 'this is not a forma share link');
  }

  const packed = fromBase64Url(text.slice(VERSION_PREFIX.length));
  let body;
  try {
    const json = await pump(new DecompressionStream('deflate-raw'), packed, MAX_UNPACKED_BYTES);
    body = JSON.parse(new TextDecoder().decode(json));
  } catch (error) {
    // Too large is worth saying as it is; anything else is a link that lost characters.
    if (error instanceof RangeError) throw error;
    throw new Error('the link is damaged - its contents do not unpack', { cause: error });
  }

  if (typeof body?.s !== 'string') throw new Error('the link is damaged - it carries no document');
  const params = body.p && typeof body.p === 'object' && !Array.isArray(body.p)
    ? /** @type {Record<string, ParameterValue>} */ (body.p)
    : {};
  return { source: body.s, params };
}
