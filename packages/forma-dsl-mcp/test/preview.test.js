import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

import { disposeSharedContext, sceneMeshes } from '../src/document.js';
import { VIEWS, encodePng, renderPreview } from '../src/preview.js';

test.after(() => disposeSharedContext());

/**
 * Reads back what {@link encodePng} wrote: enough of PNG to check the encoder, not a decoder.
 *
 * @param {Buffer} png The file.
 * @returns {{ width: number, height: number, pixel: (x: number, y: number) => number[] }}
 *   Its size, and a way to read one pixel.
 */
function readPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const chunks = [];
  for (let o = 8; o < png.length;) {
    const length = png.readUInt32BE(o);
    if (png.toString('ascii', o + 4, o + 8) === 'IDAT') chunks.push(png.subarray(o + 8, o + 8 + length));
    o += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  return {
    width,
    height,
    pixel: (x, y) => [...raw.subarray(y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3)],
  };
}

const CUBE = 'model "m" { part "body" { color = "#ff0000"  box { size = [10, 10, 10]  center = true } } }';

test('a PNG round-trips through a decoder', () => {
  const rgb = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
  const image = readPng(encodePng(rgb, 2, 2));
  assert.equal(image.width, 2);
  assert.equal(image.height, 2);
  assert.deepEqual(image.pixel(0, 0), [255, 0, 0]);
  assert.deepEqual(image.pixel(1, 0), [0, 255, 0]);
  assert.deepEqual(image.pixel(0, 1), [0, 0, 255]);
});

test('a part is drawn in its own colour, in the middle, on the background', async () => {
  const { parts } = await sceneMeshes(CUBE);
  const { png } = renderPreview(parts, { views: ['front'], size: 200 });
  const image = readPng(png);

  assert.equal(image.width, 200);
  const [r, g, b] = image.pixel(100, 100);
  assert.ok(r > 100 && g < 40 && b < 40, `the middle should be shaded red, not ${[r, g, b]}`);
  assert.deepEqual(image.pixel(2, 2), [238, 241, 245], 'the corner is background');
});

test('Z is up: in the front view a part above the origin is drawn above one below it', async () => {
  const { parts } = await sceneMeshes(`model "m" {
    part "high" { color = "#ff0000"  translate { offset = [0, 0, 20]  box { size = [10, 10, 10]  center = true } } }
    part "low" { color = "#0000ff"  box { size = [10, 10, 10]  center = true } }
  }`);
  const image = readPng(renderPreview(parts, { views: ['front'], size: 300 }).png);

  const column = Array.from({ length: 300 }, (_, y) => image.pixel(150, y));
  const firstRed = column.findIndex(([r, g, b]) => r > 100 && g < 60 && b < 60);
  const firstBlue = column.findIndex(([r, g, b]) => b > 100 && r < 60 && g < 60);
  assert.ok(firstRed >= 0 && firstBlue >= 0, 'both parts are visible');
  assert.ok(firstRed < firstBlue, 'the higher part is nearer the top of the image');
});

test('several views are laid out in a grid, as wide as asked', async () => {
  const { parts } = await sceneMeshes(CUBE);

  const four = renderPreview(parts, { views: ['iso', 'front', 'right', 'top'], size: 400 });
  assert.deepEqual([four.width, four.height, four.columns], [400, 400, 2]);

  const three = renderPreview(parts, { views: ['iso', 'front', 'top'], size: 400 });
  assert.deepEqual([three.width, three.height, three.columns], [400, 400, 2], 'two rows, one cell empty');

  const every = renderPreview(parts, { views: Object.keys(VIEWS).slice(0, 6), size: 600 });
  assert.deepEqual([every.width, every.height], [600, 400]);
});

test('an unknown view is refused by name', async () => {
  const { parts } = await sceneMeshes(CUBE);
  assert.throws(() => renderPreview(parts, { views: ['sideways'] }), /no view named "sideways" - use one of iso/);
});

test('nothing to draw is a blank image, not a failure', () => {
  const image = readPng(renderPreview([], { size: 128 }).png);
  assert.deepEqual(image.pixel(64, 64), [238, 241, 245]);
});
