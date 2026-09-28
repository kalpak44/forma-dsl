import { toRenderMesh } from './mesh.js';

/// Binary STL. Chosen over ASCII because a model of any size is several times smaller and
/// every slicer reads it.
export function toBinarySTL(manifold, header = 'forma-dsl') {
  const { positions, normals, triangleCount } = toRenderMesh(manifold);
  const buffer = new ArrayBuffer(84 + triangleCount * 50);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  bytes.set(new TextEncoder().encode(header.slice(0, 79)), 0);
  view.setUint32(80, triangleCount, true);

  for (let t = 0; t < triangleCount; t++) {
    const o = 84 + t * 50;
    view.setFloat32(o, normals[t * 9], true);
    view.setFloat32(o + 4, normals[t * 9 + 1], true);
    view.setFloat32(o + 8, normals[t * 9 + 2], true);
    for (let v = 0; v < 3; v++) {
      const p = o + 12 + v * 12;
      view.setFloat32(p, positions[t * 9 + v * 3], true);
      view.setFloat32(p + 4, positions[t * 9 + v * 3 + 1], true);
      view.setFloat32(p + 8, positions[t * 9 + v * 3 + 2], true);
    }
    view.setUint16(o + 48, 0, true);
  }

  return new Uint8Array(buffer);
}
