/// Converts an evaluated Manifold into flat typed arrays for a renderer.
///
/// `getMesh()` returns indexed triangles sharing vertices, which is what a viewer wants for
/// upload size, but shared vertices across a hard edge would be smooth-shaded. Normals are
/// therefore computed per face and the vertices expanded, so a cube reads as a cube.
export function toRenderMesh(manifold) {
  const mesh = manifold.getMesh();
  const stride = mesh.numProp;
  const triangles = mesh.triVerts.length / 3;

  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);

  for (let t = 0; t < triangles; t++) {
    const [ia, ib, ic] = [mesh.triVerts[t * 3], mesh.triVerts[t * 3 + 1], mesh.triVerts[t * 3 + 2]];
    const a = [mesh.vertProperties[ia * stride], mesh.vertProperties[ia * stride + 1], mesh.vertProperties[ia * stride + 2]];
    const b = [mesh.vertProperties[ib * stride], mesh.vertProperties[ib * stride + 1], mesh.vertProperties[ib * stride + 2]];
    const c = [mesh.vertProperties[ic * stride], mesh.vertProperties[ic * stride + 1], mesh.vertProperties[ic * stride + 2]];

    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length > 0) n = [n[0] / length, n[1] / length, n[2] / length];

    for (const [i, vertex] of [a, b, c].entries()) {
      const o = t * 9 + i * 3;
      positions[o] = vertex[0]; positions[o + 1] = vertex[1]; positions[o + 2] = vertex[2];
      normals[o] = n[0]; normals[o + 1] = n[1]; normals[o + 2] = n[2];
    }
  }

  return { positions, normals, triangleCount: triangles, vertexCount: mesh.numVert };
}
