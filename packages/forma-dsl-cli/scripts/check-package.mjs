/**
 * Verifies that the publishable tarball carries the command line and nothing else.
 *
 * The failure this catches is silent in the worst direction: a `files` list that drifted
 * after the layout moved, shipping the tests and the scripts to every consumer - or shipping
 * a package whose declared `bin` is not actually in it, which installs cleanly and then
 * fails at the user's first `forma`.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ALLOWED_ROOT_FILES = new Set(['package.json', 'README.md', 'LICENSE']);
const REQUIRED = ['src/bin.js', 'src/cli.js', 'README.md', 'LICENSE'];

const manifest = createRequire(import.meta.url)('../package.json');
const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const paths = JSON.parse(output)[0].files.map((file) => file.path).sort();

console.log(paths.join('\n'));

const stray = paths.filter((path) => !path.startsWith('src/') && !ALLOWED_ROOT_FILES.has(path));
const missing = REQUIRED.filter((path) => !paths.includes(path));

// The `bin` entry is the whole point of this package, and npm does not check that the file
// it names exists. An install would succeed and `forma` would fail with ENOENT.
const executables = Object.values(manifest.bin ?? {}).map((path) => path.replace(/^\.\//, ''));
const unshipped = executables.filter((path) => !paths.includes(path));

if (stray.length) console.error(`\nUnexpected files in the tarball:\n  ${stray.join('\n  ')}`);
if (missing.length) console.error(`\nMissing from the tarball:\n  ${missing.join('\n  ')}`);
if (unshipped.length) console.error(`\nDeclared in "bin" but not shipped:\n  ${unshipped.join('\n  ')}`);

if (stray.length || missing.length || unshipped.length) process.exit(1);
console.log(`\n${paths.length} files, all accounted for.`);
