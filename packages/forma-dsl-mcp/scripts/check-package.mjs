/**
 * Verifies that the publishable tarball carries the server, the manual, and nothing else.
 *
 * Two failures this catches, both silent in the worst direction: shipping the tests and the
 * scripts to every consumer, and shipping a server whose bundled manual was left behind — in
 * which case `forma_reference` fails at the user's first call rather than here.
 */
import { execFileSync } from 'node:child_process';

const ALLOWED_ROOT_FILES = new Set(['package.json', 'README.md', 'LICENSE']);
const REQUIRED = [
  'src/bin.js',
  'src/server.js',
  'src/tools.js',
  'README.md',
  'LICENSE',
];

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], { encoding: 'utf8' });
const paths = JSON.parse(output)[0].files.map((file) => file.path).sort();

console.log(paths.join('\n'));

const stray = paths.filter((path) => !path.startsWith('src/') && !ALLOWED_ROOT_FILES.has(path));
const missing = REQUIRED.filter((path) => !paths.includes(path));
const manual = paths.filter((path) => path.startsWith('src/reference/') && path.endsWith('.md'));

if (stray.length) console.error(`\nUnexpected files in the tarball:\n  ${stray.join('\n  ')}`);
if (missing.length) console.error(`\nMissing from the tarball:\n  ${missing.join('\n  ')}`);
if (manual.length < 20) {
  console.error(`\nOnly ${manual.length} manual pages in the tarball — run \`npm run sync:reference\`.`);
}

if (stray.length || missing.length || manual.length < 20) process.exit(1);
console.log(`\n${paths.length} files, ${manual.length} of them manual pages, all accounted for.`);
