import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';

import { encodeShare, decodeShare } from '../src/index.js';

const example = (name) => readFile(new URL(`../../../examples/${name}`, import.meta.url), 'utf8');

test('a document survives the round trip, with its param values', async () => {
  const source = await example('red-car.forma');
  const payload = await encodeShare({ source, params: { wheel: 12, label: 'top', flag: true, at: [1, 2] } });

  assert.match(payload, /^v1\.[A-Za-z0-9_-]+$/, 'versioned, and nothing that needs escaping in a URL');
  assert.deepEqual(await decodeShare(payload), {
    source,
    params: { wheel: 12, label: 'top', flag: true, at: [1, 2] },
  });
});

test('a link is much shorter than the document it carries', async () => {
  const source = await example('christmas-tree.forma');
  const payload = await encodeShare({ source });

  assert.ok(payload.length < source.length / 2, `${payload.length} is not much under ${source.length}`);
});

test('a leading # is accepted, and no params come back as none', async () => {
  const payload = await encodeShare({ source: 'model "m" { box { size = [1, 1, 1] } }' });
  assert.deepEqual(await decodeShare(`#${payload}`), {
    source: 'model "m" { box { size = [1, 1, 1] } }',
    params: {},
  });
});

test('text outside ASCII survives', async () => {
  const source = '# крепёж – ✓ 📐\nmodel "m" { box { size = [1, 1, 1] } }';
  assert.equal((await decodeShare(await encodeShare({ source }))).source, source);
});

test('every length of input encodes and decodes, whatever its padding would have been', async () => {
  for (let length = 0; length < 12; length++) {
    const source = 'x'.repeat(length);
    assert.equal((await decodeShare(await encodeShare({ source }))).source, source);
  }
});

test('a link from another format, or none at all, is refused by name', async () => {
  await assert.rejects(decodeShare('v2.abc'), /newer version of forma \(format v2\)/);
  await assert.rejects(decodeShare('#hello'), /not a forma share link/);
  await assert.rejects(decodeShare(''), /not a forma share link/);
});

test('a damaged link is refused rather than opened as something else', async () => {
  const payload = await encodeShare({ source: 'model "m" { box { size = [1, 1, 1] } }' });

  await assert.rejects(decodeShare(`${payload}!`), /not valid base64url/);
  await assert.rejects(decodeShare(payload.slice(0, -6)), /damaged/);
  await assert.rejects(decodeShare('v1.AAAA'), /damaged/);
});

test('a link that unpacks to something other than a document is refused', async () => {
  const pack = (value) => `v1.${deflateRawSync(Buffer.from(JSON.stringify(value))).toString('base64url')}`;

  await assert.rejects(decodeShare(pack({ p: { a: 1 } })), /carries no document/);
  assert.deepEqual(await decodeShare(pack({ s: 'x', p: [1, 2] })), { source: 'x', params: {} });
});

test('a link that inflates past a megabyte is refused before it is held', async () => {
  const bomb = deflateRawSync(Buffer.alloc(8 * 1024 * 1024, 0x20)).toString('base64url');
  assert.ok(bomb.length < 20_000, 'the point is that the link itself is small');
  await assert.rejects(decodeShare(`v1.${bomb}`), /larger than 1048576 bytes/);
});

test('a document is required', async () => {
  await assert.rejects(encodeShare({ source: undefined }), TypeError);
});
