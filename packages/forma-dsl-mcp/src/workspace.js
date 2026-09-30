/**
 * The patch of filesystem the server is allowed to touch.
 *
 * An MCP server writes files on behalf of a model, so the set of paths it will accept is a
 * security boundary rather than a convenience. Everything goes through `resolve`, which
 * refuses anything that lands outside the root — including by way of `..`, an absolute path,
 * or a symlink pointing out of the tree.
 */
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** How deep `list` will descend before it stops looking. */
const MAX_DEPTH = 8;

/** Directories that are never worth walking, and are large enough to be worth skipping. */
const SKIPPED = new Set(['node_modules', '.git', 'dist', 'coverage', '.cache']);

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
 * A rooted view of the filesystem.
 *
 * The root is resolved through symlinks once, at construction, so a root that is itself a
 * link still compares equal to the paths resolved beneath it.
 */
export class Workspace {
  /**
   * @param {string} root The directory every path is resolved against and confined to.
   */
  constructor(root) {
    /** @type {string} The absolute root, before symlinks are followed. */
    this.root = resolve(root);
    /** @type {string} The root with symlinks resolved; the one containment is tested against. */
    this.realRoot = this.root;
  }

  /**
   * Resolves the root through symlinks.
   *
   * Separate from the constructor because it touches the disk, and a constructor that can
   * fail on I/O is a constructor every caller has to wrap.
   *
   * @param {string} root The directory to root the workspace at.
   * @returns {Promise<Workspace>} The workspace, ready to use.
   * @throws {WorkspaceError} If the root does not exist or is not a directory.
   */
  static async open(root) {
    const workspace = new Workspace(root);
    let info;
    try {
      workspace.realRoot = await realpath(workspace.root);
      info = await stat(workspace.realRoot);
    } catch {
      throw new WorkspaceError(`the workspace root ${workspace.root} does not exist`);
    }
    if (!info.isDirectory()) {
      throw new WorkspaceError(`the workspace root ${workspace.root} is not a directory`);
    }
    return workspace;
  }

  /**
   * Turns a caller's path into an absolute one inside the root.
   *
   * Containment is checked twice: once on the lexical path, and again on the nearest
   * existing ancestor with symlinks followed. The first catches `../../etc/passwd`; the
   * second catches a directory inside the root that is a link to somewhere outside it.
   *
   * @param {string} path A path relative to the root, or an absolute one inside it.
   * @param {string} [what] What the path is for, used in the error message.
   * @returns {Promise<string>} The absolute path.
   * @throws {WorkspaceError} If the path escapes the root.
   */
  async resolve(path, what = 'path') {
    if (typeof path !== 'string' || path.trim() === '') {
      throw new WorkspaceError(`the ${what} is empty`);
    }

    const absolute = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    this.#assertInside(absolute, path, what);

    // The file itself may not exist yet — a write is the common case — so the deepest
    // ancestor that does exist is what gets its links followed.
    let existing = absolute;
    while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
    const real = await realpath(existing);
    this.#assertInside(join(real, relative(existing, absolute)), path, what);

    return absolute;
  }

  /**
   * @param {string} candidate An absolute path.
   * @param {string} original The path as the caller wrote it, for the message.
   * @param {string} what What the path is for.
   * @returns {void}
   * @throws {WorkspaceError} If the candidate is neither the root nor beneath it.
   */
  #assertInside(candidate, original, what) {
    const roots = [this.root, this.realRoot];
    const inside = roots.some((root) => candidate === root || candidate.startsWith(root + sep));
    if (!inside) {
      throw new WorkspaceError(
        `the ${what} "${original}" is outside the workspace root ${this.root}`,
      );
    }
  }

  /**
   * @param {string} path The file to read.
   * @returns {Promise<string>} Its contents, as UTF-8.
   * @throws {WorkspaceError} If the path escapes the root or names no file.
   */
  async read(path) {
    const absolute = await this.resolve(path, 'path');
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
   * @returns {Promise<{ path: string, relative: string, bytes: number, replaced: boolean }>}
   *   Where it went and how big it was.
   * @throws {WorkspaceError} If the path escapes the root, has the wrong extension, or
   *   already exists and `overwrite` was not set.
   */
  async write(path, contents, options = {}) {
    const { overwrite = false, extension } = options;
    const absolute = await this.resolve(path, 'path');

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
    return { path: absolute, relative: relative(this.root, absolute) || '.', bytes, replaced };
  }

  /**
   * Finds files by extension, so a caller can discover what is already here rather than
   * guessing at names.
   *
   * @param {string} [extension] The extension to match, including the dot.
   * @returns {Promise<string[]>} Paths relative to the root, sorted, depth-first.
   */
  async list(extension = '.forma') {
    /** @type {string[]} */
    const found = [];

    const walk = async (directory, depth) => {
      if (depth > MAX_DEPTH) return;
      /** @type {import('node:fs').Dirent[]} */
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
        const child = join(directory, entry.name);
        if (entry.isDirectory()) await walk(child, depth + 1);
        else if (entry.isFile() && extname(entry.name).toLowerCase() === extension) {
          found.push(relative(this.realRoot, child));
        }
      }
    };

    await walk(this.realRoot, 0);
    return found.sort((a, b) => a.localeCompare(b));
  }
}
