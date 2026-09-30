/**
 * Binary STL, for handing a solved part to a slicer.
 *
 * STL is the least a mesh format can carry — triangles and normals, no units, no colour and
 * no notion of a part — and it is what every slicer reads. Anything richer belongs in its
 * own exporter rather than in a dialect of this one.
 */

/** @import { Solid } from '../index.js' */

import { toRenderMesh } from './mesh.js';

// The binary STL layout, named rather than spelled as arithmetic at every offset.
const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const BODY_START = HEADER_BYTES + COUNT_BYTES;
/** A normal, three vertices, and a trailing attribute count: 12 floats and a uint16. */
const TRIANGLE_BYTES = 50;

/**
 * Encodes a solid as binary STL.
 *
 * Binary rather than ASCII because a model of any size is several times smaller and every
 * slicer reads it.
 *
 * @param {Solid} manifold The solid to encode.
 * @param {string} [header] Free text for the 80-byte header; truncated to fit, so it cannot
 *   run into the triangle count that follows it.
 * @returns {Uint8Array} The STL file.
 */
export function toBinarySTL(manifold, header = 'forma-dsl') {
  const { positions, normals, triangleCount } = toRenderMesh(manifold);
  const buffer = new ArrayBuffer(BODY_START + triangleCount * TRIANGLE_BYTES);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  bytes.set(new TextEncoder().encode(header.slice(0, HEADER_BYTES - 1)), 0);
  view.setUint32(HEADER_BYTES, triangleCount, true);

  for (let t = 0; t < triangleCount; t++) {
    const o = BODY_START + t * TRIANGLE_BYTES;

    for (let axis = 0; axis < 3; axis++) {
      view.setFloat32(o + axis * 4, normals[t * 9 + axis], true);
    }
    for (let v = 0; v < 3; v++) {
      for (let axis = 0; axis < 3; axis++) {
        view.setFloat32(o + 12 + v * 12 + axis * 4, positions[t * 9 + v * 3 + axis], true);
      }
    }

    // The attribute byte count. Nothing reads it, and slicers dislike it being anything else.
    view.setUint16(o + 48, 0, true);
  }

  return new Uint8Array(buffer);
}
