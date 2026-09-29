/** @import { IndexedMesh, RenderMesh, Solid } from '../index.js' */

/**
 * A point in space, as three numbers.
 *
 * @typedef {[number, number, number]} Triple
 */

/**
 * Reads one vertex position out of the kernel's flat property array.
 *
 * `vertProperties` interleaves whatever properties the mesh carries, so the position is the
 * first three of every `stride`, not every third entry.
 *
 * @param {IndexedMesh} mesh The kernel mesh.
 * @param {number} index Which vertex.
 * @param {number} stride How many properties each vertex carries.
 * @returns {Triple} The position.
 */
function vertexAt(mesh, index, stride) {
  const o = index * stride;
  return [mesh.vertProperties[o], mesh.vertProperties[o + 1], mesh.vertProperties[o + 2]];
}

/**
 * The unit normal of a triangle, wound counter-clockwise.
 *
 * A degenerate triangle has no direction to point in, so it keeps the zero vector rather
 * than dividing by zero and poisoning the buffer with NaN.
 *
 * @param {Triple} a First corner.
 * @param {Triple} b Second corner.
 * @param {Triple} c Third corner.
 * @returns {Triple} The normal.
 */
function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = /** @type {Triple} */ ([
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ]);
  const length = Math.hypot(n[0], n[1], n[2]);
  return length > 0 ? [n[0] / length, n[1] / length, n[2] / length] : n;
}

/**
 * Converts an evaluated Manifold into flat typed arrays for a renderer.
 *
 * `getMesh()` returns indexed triangles sharing vertices, which is what a viewer wants for
 * upload size, but shared vertices across a hard edge would be smooth-shaded. Normals are
 * therefore computed per face and the vertices expanded, so a cube reads as a cube.
 *
 * @param {Solid} manifold The solid to convert.
 * @returns {RenderMesh} Expanded positions and normals, three vertices per triangle.
 */
export function toRenderMesh(manifold) {
  const mesh = manifold.getMesh();
  const stride = mesh.numProp;
  const triangles = mesh.triVerts.length / 3;

  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);

  for (let t = 0; t < triangles; t++) {
    const corners = [
      vertexAt(mesh, mesh.triVerts[t * 3], stride),
      vertexAt(mesh, mesh.triVerts[t * 3 + 1], stride),
      vertexAt(mesh, mesh.triVerts[t * 3 + 2], stride),
    ];
    const normal = faceNormal(corners[0], corners[1], corners[2]);

    // All three corners carry the same normal; that repetition is what keeps the edge hard.
    for (const [i, corner] of corners.entries()) {
      const o = t * 9 + i * 3;
      positions[o] = corner[0]; positions[o + 1] = corner[1]; positions[o + 2] = corner[2];
      normals[o] = normal[0]; normals[o + 1] = normal[1]; normals[o + 2] = normal[2];
    }
  }

  return { positions, normals, triangleCount: triangles, vertexCount: mesh.numVert };
}
