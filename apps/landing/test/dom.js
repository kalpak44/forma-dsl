/**
 * A browser for these tests to run in.
 *
 * The landing page is written against the DOM, so testing it means providing one. jsdom
 * covers the document, the events and storage; the four APIs it does not implement —
 * `matchMedia`, the two observers and the frame callback — are faked here and driven by the
 * test, which is what turns a reveal, a resize or an animation frame into something a test
 * can make happen rather than wait for.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

/**
 * @typedef {object} Page
 * @property {import('jsdom').DOMWindow} window The window everything is installed from.
 * @property {Document} document Its document.
 * @property {(query: string, matches: boolean) => void} media Sets what a media query
 *   answers, and tells anything listening that it changed.
 * @property {(element: Element, intersecting?: boolean) => void} intersect Reports an
 *   element to every IntersectionObserver watching it.
 * @property {(element: Element) => void} resize Reports an element to every
 *   ResizeObserver watching it.
 * @property {(count?: number, time?: number) => void} frames Runs the frame callbacks that
 *   are booked, `count` times over.
 * @property {(element: Element, width: number, height: number) => void} size Gives an
 *   element a layout size, which jsdom otherwise reports as zero.
 * @property {(hidden: boolean) => void} hide Sets `document.hidden`.
 * @property {(ms: number | null) => void} clock Pins `performance.now()`, or hands it back
 *   to the real one.
 */

/** The globals installed by the last `createPage`, so a second call can replace them. */
const INSTALLED = [
  'window', 'document', 'navigator', 'localStorage', 'devicePixelRatio',
  'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLCanvasElement', 'Node', 'Event',
  'CustomEvent', 'KeyboardEvent', 'PointerEvent', 'getComputedStyle',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
  'matchMedia', 'IntersectionObserver', 'ResizeObserver',
  'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
];

/**
 * Builds a page and installs it as the process's globals.
 *
 * The modules under test read `document`, `matchMedia` and the rest as bare globals, the
 * way they would in a browser, so the page has to be installed rather than passed in.
 *
 * @param {string} [html] The document to start from.
 * @returns {Page} Handles for the things a browser would do on its own.
 */
export function createPage(html = '<!doctype html><html><body></body></html>') {
  // A console of its own, forwarded nowhere: jsdom reports every unimplemented API it is
  // asked for, and a test that deliberately drives the no-WebGL path asks for several.
  const dom = new JSDOM(html, { url: 'https://example.test/', virtualConsole: new VirtualConsole() });
  const { window } = dom;

  /** @type {Map<string, boolean>} What each media query currently answers. */
  const queries = new Map();
  /** @type {Set<{ query: string, listeners: Set<Function>, self: object }>} */
  const lists = new Set();
  /** @type {Array<{ callback: Function, targets: Set<Element> }>} */
  const intersectors = [];
  /** @type {Array<{ callback: Function, targets: Set<Element> }>} */
  const resizers = [];
  /** @type {Function[]} Frame callbacks booked and not yet run. */
  let booked = [];
  let hidden = false;
  /** @type {number | null} What `performance.now()` answers, or null for the real clock. */
  let pinned = null;
  const realNow = performance.now.bind(performance);

  /**
   * @param {string} query The media query.
   * @returns {object} A MediaQueryList that answers from `queries`.
   */
  const matchMedia = (query) => {
    const entry = {
      query,
      listeners: new Set(),
      self: /** @type {any} */ ({}),
    };
    entry.self = {
      media: query,
      get matches() { return queries.get(query) ?? false; },
      addEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => {
        if (type === 'change') entry.listeners.add(fn);
      },
      removeEventListener: (/** @type {string} */ type, /** @type {Function} */ fn) => {
        if (type === 'change') entry.listeners.delete(fn);
      },
    };
    lists.add(entry);
    return entry.self;
  };

  /**
   * @param {Function} callback What to call for each reported entry.
   * @returns {object} An observer that only records what it was asked to watch.
   */
  const observerFor = (callback, into) => {
    const record = { callback, targets: new Set() };
    into.push(record);
    return {
      observe: (/** @type {Element} */ el) => record.targets.add(el),
      unobserve: (/** @type {Element} */ el) => record.targets.delete(el),
      disconnect: () => record.targets.clear(),
    };
  };

  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    devicePixelRatio: 2,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    Node: window.Node,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    KeyboardEvent: window.KeyboardEvent,
    PointerEvent: window.Event,
    getComputedStyle: window.getComputedStyle.bind(window),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    dispatchEvent: window.dispatchEvent.bind(window),
    matchMedia,
    IntersectionObserver: class {
      /** @param {Function} callback What to call for each reported entry. */
      constructor(callback) { return observerFor(callback, intersectors); }
    },
    ResizeObserver: class {
      /** @param {Function} callback What to call for each reported entry. */
      constructor(callback) { return observerFor(callback, resizers); }
    },
    // The demo types off the clock rather than off the frame count, so a test that wants
    // to watch it type has to be able to move the clock rather than wait out the document.
    performance: { now: () => pinned ?? realNow() },
    requestAnimationFrame: (/** @type {Function} */ fn) => { booked.push(fn); return booked.length; },
    cancelAnimationFrame: () => {},
  };

  // defineProperty rather than assignment: Node declares some of these — `navigator` — as
  // accessors with no setter, and assigning to one throws.
  for (const key of INSTALLED) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: globals[key] });
  }
  window.matchMedia = matchMedia;
  window.IntersectionObserver = globals.IntersectionObserver;
  window.ResizeObserver = globals.ResizeObserver;
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });

  return {
    window,
    document: window.document,

    media(query, matches) {
      queries.set(query, matches);
      for (const entry of lists) {
        if (entry.query === query) for (const fn of entry.listeners) fn({ matches });
      }
    },

    intersect(element, intersecting = true) {
      for (const record of intersectors) {
        if (record.targets.has(element)) {
          record.callback([{ target: element, isIntersecting: intersecting }], {
            unobserve: (/** @type {Element} */ el) => record.targets.delete(el),
            disconnect: () => record.targets.clear(),
          });
        }
      }
    },

    resize(element) {
      for (const record of resizers) {
        if (record.targets.has(element)) record.callback([{ target: element }]);
      }
    },

    frames(count = 1, time = 16) {
      for (let i = 0; i < count; i += 1) {
        const due = booked;
        booked = [];
        for (const fn of due) fn(time * (i + 1));
      }
    },

    size(element, width, height) {
      Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
      Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
    },

    hide(value) { hidden = value; },

    clock(ms) { pinned = ms; },
  };
}
