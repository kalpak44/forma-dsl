/**
 * Runs the landing page's tests, where the runtime can load them.
 *
 * They run in jsdom, and the undici jsdom brings needs `zlib.createZstdDecompress` the moment
 * it is imported - Node 22.15 and later. The releases of undici before it needed that are the
 * ones with published advisories, so pinning back to one is not an option either. On an older
 * Node the tests are skipped, and say so: the page is built and served by a current Node, and
 * nothing published depends on jsdom, so the floor the packages promise is not moved for it.
 */
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';

if (typeof zlib.createZstdDecompress !== 'function') {
  console.log(
    `Skipping the landing page's tests on Node ${process.version}: jsdom's undici needs `
    + 'zlib zstd support, which arrived in Node 22.15.',
  );
  process.exit(0);
}

const { status } = spawnSync(process.execPath, ['--test'], { stdio: 'inherit' });
process.exit(status ?? 1);
