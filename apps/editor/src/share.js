/**
 * Where a share link's payload sits in the editor's URL, and how a link is put together.
 *
 * Packing the document is the library's job (`encodeShare`); this is only the part that
 * knows about this page's address, kept apart from `main.js` so it can be tested without a
 * browser.
 */

/**
 * Links longer than this survive a browser but not every chat app or issue tracker, some of
 * which cut a message at a few thousand characters.
 */
export const LONG_LINK = 8000;

/**
 * The payload in a URL fragment, if the fragment is a share link at all.
 *
 * Any `v<n>.` counts, not just the version this build reads, so a link from a newer format
 * is reported as such rather than silently ignored.
 *
 * @param {string} hash The fragment, as `location.hash` gives it.
 * @returns {string | null} The payload, or null when the fragment is not a share link.
 */
export function sharedPayload(hash) {
  const payload = hash.startsWith('#') ? hash.slice(1) : hash;
  return /^v\d+\./.test(payload) ? payload : null;
}

/**
 * The editor's address with a payload as its fragment.
 *
 * Built from the current address rather than a configured one, so a link made on a local
 * build or a fork opens on that build or fork.
 *
 * @param {string} href The editor's current address.
 * @param {string} payload What `encodeShare` returned.
 * @returns {string} The link.
 */
export function linkTo(href, payload) {
  const url = new URL(href);
  url.hash = payload;
  return url.href;
}
