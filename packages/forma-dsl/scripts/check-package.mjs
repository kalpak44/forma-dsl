/**
 * Verifies that the publishable tarball carries the library and nothing else.
 *
 * `files` in package.json is easy to leave behind when the layout moves, and the failure is
 * silent in the worst direction: shipping web/ and test/ to every consumer, or shipping a
 * package whose declared `types` entry is not actually in it.
 */
import { execFileSync } from 'node:child_process';

const ALLOWED_ROOT_FILES = new Set(['package.json', 'README.md', 'LICENSE']);
// The README and the licence are the package's npm page and its legal terms; a publish
// without them is a broken listing, and nothing else notices.
const REQUIRED = ['src/index.js', 'src/index.d.ts', 'README.md', 'LICENSE'];

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const paths = JSON.parse(output)[0].files.map((file) => file.path).sort();

console.log(paths.join('\n'));

const stray = paths.filter((path) => !path.startsWith('src/') && !ALLOWED_ROOT_FILES.has(path));
const missing = REQUIRED.filter((path) => !paths.includes(path));

if (stray.length) console.error(`\nUnexpected files in the tarball:\n  ${stray.join('\n  ')}`);
if (missing.length) console.error(`\nMissing from the tarball:\n  ${missing.join('\n  ')}`);

if (stray.length || missing.length) process.exit(1);
console.log(`\n${paths.length} files, all accounted for.`);
