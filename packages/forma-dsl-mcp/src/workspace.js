/**
 * The patch of filesystem the server is allowed to touch.
 *
 * An MCP server writes files on behalf of a model, so the set of paths it will accept is a
 * security boundary rather than a convenience. Which directories make up that set is the
 * client's decision — it declares them as MCP roots, and {@link Workspace} only asks. What
 * the workspace enforces is that everything goes through `resolve`, which refuses anything
 * landing outside all of them, including by way of `..`, an absolute path, or a symlink
 * pointing out of the tree.
 */
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * What one path segment inside a root may be.
 *
 * Nothing that separates, escapes or terminates: no slash either way, no NUL, and `..`
 * is rejected alongside it. Every path handed to the filesystem is rebuilt from a root and
 * segments that passed this, so the value that reaches `readFile` is constructed here rather
 * than carried in from the caller.
 */
const SAFE_SEGMENT = /^[^\0/\\]+$/;

/** Raised for a path the workspace refuses, so a handler can report it as the caller's fault. */
export class WorkspaceError extends Error {
  /**
   * @param {string} message What was refused, and why.
   */
  constructor(message) {
    super(message);
    /** @type {string} Distinguishes a refusal from a genuine I/O failure. */
    this.name = 'WorkspaceError';
  }
}

/**
 * @typedef {object} Root
 * @property {string} path The directory as the client named it, made absolute.
 * @property {string} realPath The same directory with symlinks followed, which containment
 *   is tested against.
 */

/**
 * A view of the filesystem confined to the directories the client declared.
 *
 * The directories are asked for lazily and then cached, because the client cannot be asked
 * until it has finished connecting, and because asking on every call would put a round trip
 * in front of every file read. `forget` drops the cache when the client says they changed.
 */
export class Workspace {
  /** @type {() => Promise<string[]> | string[]} Where the directories come from. */
  #supply;

  /** @type {Root[] | null} The resolved roots, once they have been asked for. */
  #roots = null;

  /**
   * @param {(() => Promise<string[]> | string[]) | string[] | string} supply The directories
   *   to confine to, or something that produces them when asked.
   */
  constructor(supply) {
    this.#supply = typeof supply === 'function' ? supply : () => supply;
  }

  /**
   * A workspace confined to one directory, checked now rather than at first use.
   *
   * Useful for embedding the server in something that already knows where the files live,
   * and for tests, which want a bad root to fail where it is written.
   *
   * @param {string} root The directory to root the workspace at.
   * @returns {Promise<Workspace>} The workspace, with its root already resolved.
   * @throws {WorkspaceError} If the root does not exist or is not a directory.
   */
  static async open(root) {
    const workspace = new Workspace([root]);
    await workspace.roots();
    return workspace;
  }

  /**
   * The directories in force, resolved through symlinks.
   *
   * A root is resolved once and remembered, so a root that is itself a link still compares
   * equal to the paths resolved beneath it. Roots that do not exist are dropped rather than
   * fatal — a client may well declare a directory this server has no business in — and only
   * an empty result is an error.
   *
   * @returns {Promise<Root[]>} The roots, in the order the client gave them.
   * @throws {WorkspaceError} If not one of them is a usable directory.
   */
  async roots() {
    if (this.#roots) return this.#roots;

    const given = await this.#supply();
    // Deduplicated before anything touches the disk, so a client that declares the same
    // directory twice is one stat rather than two.
    const wanted = [...new Set((Array.isArray(given) ? given : [given])
      .filter((each) => typeof each === 'string' && each.trim() !== '')
      .map((each) => resolve(each)))];

    const examined = await Promise.all(wanted.map(async (path) => {
      try {
        const realPath = await realpath(path);
        if (!(await stat(realPath)).isDirectory()) {
          return { path, why: `${path} is not a directory` };
        }
        return { path, realPath };
      } catch {
        return { path, why: `${path} does not exist` };
      }
    }));

    /** @type {Root[]} */
    const roots = [];
    /** @type {string[]} */
    const refused = [];
    for (const entry of examined) {
      if (entry.why) refused.push(entry.why);
      else roots.push({ path: entry.path, realPath: /** @type {string} */ (entry.realPath) });
    }

    if (!roots.length) {
      throw new WorkspaceError(
        refused.length
          ? `no usable workspace root — ${refused.join('; ')}`
          : 'the client has declared no workspace root, so there is nowhere to read or write; '
            + 'declare one with the MCP roots capability',
      );
    }

    this.#roots = roots;
    return roots;
  }

  /**
   * Drops the resolved roots, so the next call asks for them again.
   *
   * Called when the client sends `notifications/roots/list_changed`, which is the only way
   * the set is allowed to move.
   *
   * @returns {void}
   */
  forget() {
    this.#roots = null;
  }

  /**
   * The root a relative path is taken against, which is the first the client declared.
   *
   * @returns {Promise<Root>} The primary root.
   * @throws {WorkspaceError} If there is no usable root.
   */
  async primary() {
    const [first] = await this.roots();
    return first;
  }

  /**
   * Turns a caller's path into an absolute one inside a root.
   *
   * Containment is checked twice: once on the lexical path, and again on the nearest
   * existing ancestor with symlinks followed. The first catches `../../etc/passwd`; the
   * second catches a directory inside a root that is a link to somewhere outside it.
   *
   * @param {string} path A path relative to the primary root, or an absolute one inside any
   *   of them.
   * @param {string} [what] What the path is for, used in the error message.
   * @returns {Promise<{ absolute: string, root: Root }>} The path, and the root holding it.
   * @throws {WorkspaceError} If the path escapes every root.
   */
  async resolve(path, what = 'path') {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new WorkspaceError(`the ${what} is empty`);
    }

    const roots = await this.roots();
    const lexical = isAbsolute(path) ? resolve(path) : resolve(roots[0].path, path);

    const root = this.#holderOf(roots, lexical);
    if (!root) throw this.#outside(roots, path, what);

    // Rebuilt before anything touches the disk, which is the order that matters: the string
    // the caller gave is used to choose segments and never to name a file. Each segment has
    // to match SAFE_SEGMENT, and what comes out is assembled onto a directory the client
    // declared. Every line below, and every caller, works with that value rather than the one
    // that came in — so the walk beneath cannot be steered by a name this never approved.
    const base = this.#baseOf(root, lexical);
    const segments = relative(base, lexical).split(sep).filter(Boolean);
    if (!segments.every((segment) => SAFE_SEGMENT.test(segment))) {
      throw this.#outside(roots, path, what);
    }
    const absolute = segments.reduce((at, segment) => join(at, segment), base);

    // The file itself may not exist yet — a write is the common case — so the deepest
    // ancestor that does exist is what gets its links followed. This is the one check that
    // cannot be made without the filesystem: whether a directory inside a root is a link out
    // of it is not answerable from the path alone.
    let existing = absolute;
    while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
    const real = await realpath(existing);
    if (!this.#holderOf(roots, join(real, relative(existing, absolute)))) {
      throw this.#outside(roots, path, what);
    }

    return { absolute, root };
  }

  /**
   * Which spelling of a root a path sits under — the one the client gave, or the one symlinks
   * resolve it to.
   *
   * @param {Root} root The root holding it.
   * @param {string} absolute The path.
   * @returns {string} The prefix to measure against.
   */
  #baseOf(root, absolute) {
    return absolute === root.path || absolute.startsWith(root.path + sep) ? root.path : root.realPath;
  }

  /**
   * @param {Root[]} roots The roots to test against.
   * @param {string} candidate An absolute path.
   * @returns {Root | null} The root that holds it, or null if none does.
   */
  #holderOf(roots, candidate) {
    return roots.find(({ path, realPath }) => [path, realPath].some(
      (root) => candidate === root || candidate.startsWith(root + sep),
    )) ?? null;
  }

  /**
   * @param {Root[]} roots The roots the path missed.
   * @param {string} original The path as the caller wrote it, for the message.
   * @param {string} what What the path is for.
   * @returns {WorkspaceError} The refusal, ready to throw.
   */
  #outside(roots, original, what) {
    const named = roots.map((root) => root.path).join(', ');
    const noun = roots.length > 1 ? 'roots' : 'root';
    return new WorkspaceError(
      `the ${what} "${original}" is outside the workspace ${noun} ${named}`,
    );
  }

  /**
   * @param {Root} root The root the path was resolved against.
   * @param {string} absolute The path.
   * @returns {string} The path within the root.
   */
  #within(root, absolute) {
    return relative(this.#baseOf(root, absolute), absolute) || '.';
  }

  /**
   * @param {string} path The file to read.
   * @returns {Promise<string>} Its contents, as UTF-8.
   * @throws {WorkspaceError} If the path escapes the roots or names no file.
   */
  async read(path) {
    const { absolute } = await this.resolve(path, 'path');
    try {
      return await readFile(absolute, 'utf8');
    } catch {
      throw new WorkspaceError(`no file at "${path}"`);
    }
  }

  /**
   * Writes a file, creating the directories above it.
   *
   * Refuses to replace an existing file unless told to: a model that regenerates a document
   * it did not mean to touch has no undo, and the client's own diff view is not in the loop
   * for a tool call.
   *
   * @param {string} path Where to write.
   * @param {string | Uint8Array} contents What to write.
   * @param {object} [options] How to write it.
   * @param {boolean} [options.overwrite] Whether replacing an existing file is allowed.
   * @param {string} [options.extension] An extension the path must have.
   * @returns {Promise<{ path: string, relative: string, root: string, bytes: number, replaced: boolean }>}
   *   Where it went and how big it was.
   * @throws {WorkspaceError} If the path escapes the roots, has the wrong extension, or
   *   already exists and `overwrite` was not set.
   */
  async write(path, contents, options = {}) {
    const { overwrite = false, extension } = options;
    const { absolute, root } = await this.resolve(path, 'path');

    if (extension && extname(absolute).toLowerCase() !== extension) {
      throw new WorkspaceError(`"${path}" must end in ${extension}`);
    }

    const replaced = existsSync(absolute);
    if (replaced && !overwrite) {
      throw new WorkspaceError(`"${path}" already exists — pass overwrite: true to replace it`);
    }

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, contents);

    const bytes = typeof contents === 'string' ? Buffer.byteLength(contents) : contents.length;
    return { path: absolute, relative: this.#within(root, absolute), root: root.path, bytes, replaced };
  }
}
