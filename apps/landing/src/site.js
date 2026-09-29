/**
 * The parts of the page every sheet has: the theme switch, the reveal-on-scroll, the facts
 * in the title block, and the copy button. Loaded by the landing page and by the legal
 * pages alike, which is why nothing here assumes an element exists.
 */

import pkg from 'forma-dsl/package.json';

/** Where the chosen theme is remembered. Shared with nothing else, hence the prefix. */
const STORAGE_KEY = 'forma:theme';

/** Fired on `window` after the theme changes, so the WebGL scenes can repaint in it. */
export const THEME_EVENT = 'forma:theme';

/**
 * localStorage that cannot take the page down.
 *
 * It throws outright when storage is blocked rather than returning null, and the theme is
 * read during start-up, so an unguarded access would be a blank page in a locked-down
 * browser.
 */
const storage = {
  /**
   * @param {string} key The key.
   * @returns {string | null} The value, or null if there is none or storage is blocked.
   */
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },

  /**
   * @param {string} key The key.
   * @param {string} value The value.
   * @returns {void}
   */
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* blocked or over quota; not fatal */ }
  },
};

/**
 * The theme in force right now.
 *
 * An explicit choice wins; with none, the OS preference does, which is what the stylesheet
 * already assumes when the attribute is absent.
 *
 * @returns {'dark' | 'light'} The current theme.
 */
export function currentTheme() {
  const set = document.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set;
  // Only reachable with scripting disabled between the bootstrap and here, in which case
  // the stylesheet's own default is what is on screen.
  return 'dark';
}

/**
 * Wires the theme button, and keeps following the OS until someone presses it.
 *
 * @returns {void}
 */
export function initTheme() {
  const button = document.getElementById('theme');
  if (!button) return;

  button.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    storage.set(STORAGE_KEY, next);
    dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }));
  });

  // Someone who never pressed the button is following their system, so a change to it
  // should reach the page rather than being pinned to whatever it was on first paint.
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', (event) => {
    if (storage.get(STORAGE_KEY)) return;
    document.documentElement.dataset.theme = event.matches ? 'light' : 'dark';
    dispatchEvent(new CustomEvent(THEME_EVENT, { detail: currentTheme() }));
  });
}

/**
 * Reveals elements as they scroll in.
 *
 * Each element is unobserved once shown: this is an entrance, not a scroll-linked effect,
 * and re-hiding something the reader has already read is worse than no animation at all.
 *
 * @returns {void}
 */
export function initReveals() {
  const targets = document.querySelectorAll('.reveal');
  if (!targets.length) return;

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const el of targets) el.classList.add('in');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });

  for (const el of targets) observer.observe(el);
}

/**
 * Fills the facts in the title block and the colophon from the package itself, so a release
 * cannot leave the page claiming a version that is no longer published.
 *
 * @returns {void}
 */
export function initFacts() {
  const deps = Object.keys(pkg.dependencies ?? {});
  const values = {
    version: `v${pkg.version}`,
    deps: `${deps.length} · ${deps.join(', ')}`,
    year: String(new Date().getFullYear()),
  };

  for (const [key, value] of Object.entries(values)) {
    for (const el of document.querySelectorAll(`[data-fill="${key}"]`)) el.textContent = value;
  }
}

/**
 * Wires a copy button to the block it names.
 *
 * The clipboard is refused outright in some contexts, so the failure path says so on the
 * button rather than leaving a reader who pressed it with no idea whether it worked.
 *
 * @returns {void}
 */
export function initCopy() {
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      const source = document.getElementById(/** @type {string} */ (button.getAttribute('data-copy')));
      if (!source) return;
      try {
        await navigator.clipboard.writeText(source.textContent ?? '');
        button.textContent = 'copied';
        button.classList.add('done');
      } catch {
        button.textContent = 'press ⌘C';
      }
      setTimeout(() => {
        button.textContent = 'copy';
        button.classList.remove('done');
      }, 1800);
    });
  }
}

/**
 * Everything every page needs, in one call.
 *
 * @returns {void}
 */
export function initSite() {
  initTheme();
  initReveals();
  initFacts();
  initCopy();
}
