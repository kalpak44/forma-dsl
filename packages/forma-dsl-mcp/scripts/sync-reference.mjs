/**
 * Copies the reference manual into the package, so a published install carries it.
 *
 * The manual lives in apps/docs/content, which is a private workspace and cannot be depended
 * on from something that ships to npm. Copying is the only way the server can answer from it
 * offline — and a copy is only safe if it cannot drift, which is what
 * test/reference.test.js asserts by comparing the two trees byte for byte.
 *
 * Run it after editing the manual: `npm run sync:reference -w forma-dsl-mcp`.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../../../apps/docs/content/', import.meta.url));
const TARGET = fileURLToPath(new URL('../src/reference/', import.meta.url));

if (!existsSync(SOURCE)) {
  console.error(`No manual at ${SOURCE} — this script only runs inside the monorepo.`);
  process.exit(1);
}

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });
await cp(SOURCE, TARGET, { recursive: true, filter: (path) => !path.endsWith('.DS_Store') });

console.log(`Copied the manual from ${SOURCE} to ${TARGET}.`);
