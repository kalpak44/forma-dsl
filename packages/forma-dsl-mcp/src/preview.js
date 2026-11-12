/**
 * Drawing solved parts to a PNG, with nothing but the CPU.
 *
 * The preview is for the model that wrote the document as much as for the person reading
 * along: a bounding box says a car is the right size, and only a picture says the wheels are
 * inside the body. A server on a pipe has no GPU and no browser to borrow one from, so this
 * is a small software rasteriser - orthographic, depth-buffered, flat-shaded with the
 * editor's lights, with outlines found in screen space - and a PNG encoder on top of zlib.
 *
 * Orthographic rather than perspective on purpose: these are things to be printed, and a
 * view in which parallel edges stay parallel is the one where a misalignment shows.
 */

import { crc32, deflateSync } from 'node:zlib';

/**
 * @typedef {[number, number, number]} Triple
 */

/**
 * One part, as the rasteriser needs it.
 *
 * @typedef {object} PreviewPart
 * @property {Float32Array} positions Three vertices per triangle.
 * @property {Float32Array} normals One normal per vertex, the same for all three of a face.
 * @property {string} color A CSS hex colour.
 * @property {number} opacity From 0 to 1.
 */

/**
 * Where each view looks from, and which way is up in it.
 *
 * Z is up, as in the language and the editor. `iso` is the editor's own framing direction, so
 * a preview and a first look in the editor agree.
 *
 * @type {Record<string, { from: Triple, up: Triple, label: string }>}
 */
export const VIEWS = {
  iso: { from: [0.6, -0.9, 0.55], up: [0, 0, 1], label: 'isometric, from the front right and above' },
  front: { from: [0, -1, 0], up: [0, 0, 1], label: 'front, looking along +Y' },
  back: { from: [0, 1, 0], up: [0, 0, 1], label: 'back, looking along -Y' },
  right: { from: [1, 0, 0], up: [0, 0, 1], label: 'right, looking along -X' },
  left: { from: [-1, 0, 0], up: [0, 0, 1], label: 'left, looking along +X' },
  top: { from: [0, 0, 1], up: [0, 1, 0], label: 'top, looking down -Z, +Y up the image' },
  bottom: { from: [0, 0, -1], up: [0, 1, 0], label: 'bottom, looking up +Z, +Y up the image' },
};

/** Light grey: the outlines are dark, and dark on dark is where an edge goes missing. */
const BACKGROUND = /** @type {Triple} */ ([238, 241, 245]);
const OUTLINE = /** @type {Triple} */ ([27, 33, 41]);
const DIVIDER = /** @type {Triple} */ ([206, 212, 220]);

/** Every view is drawn this many times larger, then averaged down - cheap antialiasing. */
const SUPERSAMPLE = 2;

/** How much of a cell the model may fill, leaving a margin around it. */
const FILL = 0.86;

/** Faces meeting at a sharper angle than this get a line between them. */
const CREASE = Math.cos((25 * Math.PI) / 180);

/** The editor's lights, as directions: a key for form and a cool fill for the shadow side. */
const KEY = normalize([1, -1.4, 2]);
const FILL_LIGHT = normalize([-1.5, 1, 0.5]);

/**
 * @param {Triple} v A vector.
 * @returns {Triple} The same direction, unit length.
 */
function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * @param {Triple} a One vector.
 * @param {Triple} b Another.
 * @returns {Triple} Their cross product.
 */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * @param {string} hex `#rgb` or `#rrggbb`.
 * @returns {Triple} The colour, each channel 0 to 1. Anything unreadable is the editor's grey.
 */
function parseColor(hex) {
  let digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex ?? '')?.[1] ?? '6f7d8c';
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
  return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16) / 255);
}

/**
 * How a face of a given colour and orientation is lit - the editor's three lights, reduced
 * to arithmetic.
 *
 * @param {Triple} base The part's colour.
 * @param {number} nx The face normal's x.
 * @param {number} ny Its y.
 * @param {number} nz Its z.
 * @returns {Triple} The lit colour, 0 to 255.
 */
function shade(base, nx, ny, nz) {
  const key = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
  const fill = Math.max(0, nx * FILL_LIGHT[0] + ny * FILL_LIGHT[1] + nz * FILL_LIGHT[2]);
  // A hemisphere: faces pointing up catch the sky, faces pointing down the dimmer ground.
  const sky = 0.5 * (nz + 1);
  const fillTint = [0.56, 0.7, 1];
  return /** @type {Triple} */ (base.map((channel, i) => {
    const ambient = 0.28 + 0.2 * sky;
    const light = ambient + 0.62 * key + 0.22 * fill * fillTint[i];
    return Math.min(255, Math.round(255 * channel * light));
  }));
}

/**
 * The camera for one view: three axes and the scale and offset that fit the model in a cell.
 *
 * @param {ReadonlyArray<PreviewPart>} parts What will be drawn.
 * @param {{ from: Triple, up: Triple }} view Where to look from.
 * @param {number} cell The cell's side, in supersampled pixels.
 * @returns {{ right: Triple, up: Triple, forward: Triple, scale: number, cx: number, cy: number }}
 *   The camera.
 */
function cameraFor(parts, view, cell) {
  const forward = normalize(/** @type {Triple} */ (view.from.map((v) => -v)));
  const right = normalize(cross(forward, view.up));
  const up = cross(right, forward);

  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const { positions } of parts) {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] * right[0] + positions[i + 1] * right[1] + positions[i + 2] * right[2];
      const y = positions[i] * up[0] + positions[i + 1] * up[1] + positions[i + 2] * up[2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }

  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  return {
    right, up, forward,
    scale: (cell * FILL) / span,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/**
 * One supersampled view: colour, depth and the normal at every pixel.
 *
 * @typedef {object} Frame
 * @property {number} size The side, in pixels.
 * @property {Uint8ClampedArray} color RGB per pixel.
 * @property {Float32Array} depth Distance along the view per pixel; Infinity where empty.
 * @property {Float32Array} normal The face normal per pixel, for finding creases.
 */

/**
 * One triangle on screen: its corners in pixels, their depths, and its signed area.
 *
 * @typedef {object} ScreenTriangle
 * @property {Float64Array} x The corners' x, in pixels.
 * @property {Float64Array} y The corners' y, in pixels, down the image.
 * @property {Float64Array} z The corners' distance along the view.
 * @property {number} area Twice the signed area, which the barycentric weights divide by.
 */

/**
 * Projects one triangle into a frame.
 *
 * @param {Float32Array} positions The part's vertices.
 * @param {number} t Where the triangle starts in them.
 * @param {ReturnType<typeof cameraFor>} camera How to look at it.
 * @param {number} half Half the frame's side.
 * @param {ScreenTriangle} out Where to put the result, reused across triangles.
 * @returns {ScreenTriangle} `out`.
 */
function project(positions, t, camera, half, out) {
  const { right, up, forward, scale, cx, cy } = camera;
  for (let v = 0; v < 3; v++) {
    const o = t + v * 3;
    const x = positions[o]; const y = positions[o + 1]; const z = positions[o + 2];
    out.x[v] = half + (x * right[0] + y * right[1] + z * right[2] - cx) * scale;
    out.y[v] = half - (x * up[0] + y * up[1] + z * up[2] - cy) * scale;
    out.z[v] = x * forward[0] + y * forward[1] + z * forward[2];
  }
  out.area = (out.x[1] - out.x[0]) * (out.y[2] - out.y[0]) - (out.x[2] - out.x[0]) * (out.y[1] - out.y[0]);
  return out;
}

/**
 * Fills one projected triangle, depth-tested.
 *
 * An opaque face writes depth and its normal, which the outlines are found from; a
 * translucent one only blends its colour over what is already there.
 *
 * @param {Frame} frame The frame, changed in place.
 * @param {ScreenTriangle} tri The triangle.
 * @param {Triple} lit Its shaded colour.
 * @param {Triple} n Its normal.
 * @param {number} alpha Its opacity.
 * @returns {void}
 */
function fill(frame, tri, lit, n, alpha) {
  const { size, color, depth, normal } = frame;
  const { x, y, z, area } = tri;
  const x0 = Math.max(0, Math.floor(Math.min(x[0], x[1], x[2])));
  const x1 = Math.min(size - 1, Math.ceil(Math.max(x[0], x[1], x[2])));
  const y0 = Math.max(0, Math.floor(Math.min(y[0], y[1], y[2])));
  const y1 = Math.min(size - 1, Math.ceil(Math.max(y[0], y[1], y[2])));

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5; const qy = py + 0.5;
      // Barycentric weights; dividing by the signed area makes this indifferent to winding.
      const w0 = ((x[1] - qx) * (y[2] - qy) - (x[2] - qx) * (y[1] - qy)) / area;
      const w1 = ((x[2] - qx) * (y[0] - qy) - (x[0] - qx) * (y[2] - qy)) / area;
      const w2 = 1 - w0 - w1;
      const p = py * size + px;
      const d = w0 * z[0] + w1 * z[1] + w2 * z[2];
      if (w0 < 0 || w1 < 0 || w2 < 0 || d >= depth[p]) continue;

      if (alpha >= 1) {
        depth[p] = d;
        color.set(lit, p * 3);
        normal.set(n, p * 3);
      } else {
        for (let c = 0; c < 3; c++) color[p * 3 + c] = color[p * 3 + c] * (1 - alpha) + lit[c] * alpha;
      }
    }
  }
}

/**
 * Rasterises every triangle of every part into one frame.
 *
 * Opaque parts first, then the translucent ones blended over them; a closed solid's back
 * faces are never visible, so they are skipped, which also keeps a translucent part from
 * being blended with its own far side.
 *
 * @param {ReadonlyArray<PreviewPart>} parts What to draw.
 * @param {ReturnType<typeof cameraFor>} camera How to look at it.
 * @param {number} size The frame's side, in pixels.
 * @returns {Frame} The frame.
 */
function rasterise(parts, camera, size) {
  const color = new Uint8ClampedArray(size * size * 3);
  for (let p = 0; p < size * size; p++) color.set(BACKGROUND, p * 3);
  const frame = {
    size,
    color,
    depth: new Float32Array(size * size).fill(Infinity),
    normal: new Float32Array(size * size * 3),
  };

  const { forward } = camera;
  /** @type {ScreenTriangle} */
  const tri = { x: new Float64Array(3), y: new Float64Array(3), z: new Float64Array(3), area: 0 };

  const ordered = [...parts].sort((a, b) => Number(a.opacity < 1) - Number(b.opacity < 1));
  for (const part of ordered) {
    const base = parseColor(part.color);
    const alpha = Math.max(0, Math.min(1, part.opacity ?? 1));
    const { positions, normals } = part;

    for (let t = 0; t < positions.length; t += 9) {
      const n = /** @type {Triple} */ ([normals[t], normals[t + 1], normals[t + 2]]);
      if (n[0] * forward[0] + n[1] * forward[1] + n[2] * forward[2] >= 0) continue;
      project(positions, t, camera, size / 2, tri);
      if (Math.abs(tri.area) < 1e-12) continue;
      fill(frame, tri, shade(base, n[0], n[1], n[2]), n, alpha);
    }
  }

  return frame;
}

/**
 * Darkens the pixels on a silhouette, a step in depth, or a crease between two faces.
 *
 * Done on the finished frame rather than by drawing mesh edges, because it finds exactly the
 * edges that are visible, and costs the same however many triangles the model has.
 *
 * @param {Frame} frame The frame, changed in place.
 * @param {number} step How far apart in depth two neighbours must be to count as a step.
 * @returns {void}
 */
function outline(frame, step) {
  const { size, color, depth, normal } = frame;
  const edge = new Uint8Array(size * size);

  /**
   * @param {number} a A pixel.
   * @param {number} b Its neighbour.
   * @returns {boolean} Whether a line runs between them.
   */
  const differ = (a, b) => {
    const da = depth[a]; const db = depth[b];
    if (da === Infinity || db === Infinity) return da !== db;
    if (Math.abs(da - db) > step) return true;
    const dot = normal[a * 3] * normal[b * 3] + normal[a * 3 + 1] * normal[b * 3 + 1]
      + normal[a * 3 + 2] * normal[b * 3 + 2];
    return dot < CREASE;
  };

  /**
   * Marks both pixels when a line runs between them, which makes the line two pixels wide
   * here and one after the frame is averaged down.
   *
   * @param {number} a A pixel.
   * @param {number} b Its neighbour.
   * @returns {void}
   */
  const mark = (a, b) => {
    if (differ(a, b)) { edge[a] = 1; edge[b] = 1; }
  };

  for (let p = 0; p < size * size; p++) {
    if ((p + 1) % size !== 0) mark(p, p + 1);
    if (p + size < size * size) mark(p, p + size);
  }

  for (let p = 0; p < size * size; p++) {
    if (!edge[p]) continue;
    for (let c = 0; c < 3; c++) color[p * 3 + c] = color[p * 3 + c] * 0.3 + OUTLINE[c] * 0.7;
  }
}

/**
 * Draws a small X/Y/Z triad in the bottom-left corner, so a view says which way it faces.
 *
 * Red, green and blue, as in every 3D tool, and an axis pointing straight at the viewer is
 * left out rather than drawn as a dot.
 *
 * @param {Frame} frame The frame, changed in place.
 * @param {ReturnType<typeof cameraFor>} camera The view's camera.
 * @returns {void}
 */
function triad(frame, camera) {
  const { size } = frame;
  const length = size * 0.07;
  const ox = size * 0.06 + length;
  const oy = size - size * 0.06 - length;
  const axes = [
    { axis: [1, 0, 0], rgb: [214, 69, 65] },
    { axis: [0, 1, 0], rgb: [76, 160, 90] },
    { axis: [0, 0, 1], rgb: [66, 110, 214] },
  ];
  const thickness = Math.max(1, Math.round(size / 300));

  for (const { axis, rgb } of axes) {
    const dx = axis[0] * camera.right[0] + axis[1] * camera.right[1] + axis[2] * camera.right[2];
    const dy = -(axis[0] * camera.up[0] + axis[1] * camera.up[1] + axis[2] * camera.up[2]);
    if (Math.hypot(dx, dy) < 0.2) continue;

    const steps = Math.ceil(length * 2);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(ox + (dx * length * s) / steps);
      const y = Math.round(oy + (dy * length * s) / steps);
      stamp(frame, x, y, thickness, rgb);
    }
  }
}

/**
 * Paints a small square, clipped to the frame.
 *
 * @param {Frame} frame The frame, changed in place.
 * @param {number} x Its centre's x.
 * @param {number} y Its centre's y.
 * @param {number} radius How far it reaches either side of the centre.
 * @param {number[]} rgb The colour.
 * @returns {void}
 */
function stamp(frame, x, y, radius, rgb) {
  const { size, color } = frame;
  for (let py = Math.max(0, y - radius); py <= Math.min(size - 1, y + radius); py++) {
    for (let px = Math.max(0, x - radius); px <= Math.min(size - 1, x + radius); px++) {
      color.set(rgb, (py * size + px) * 3);
    }
  }
}

/**
 * Renders one view of the parts to a square of RGB pixels.
 *
 * @param {ReadonlyArray<PreviewPart>} parts What to draw.
 * @param {string} name Which of {@link VIEWS}.
 * @param {number} cell The side of the result, in pixels.
 * @returns {Uint8ClampedArray} RGB, `cell` by `cell`.
 */
function renderView(parts, name, cell) {
  const size = cell * SUPERSAMPLE;
  const camera = cameraFor(parts, VIEWS[name], size);
  const frame = rasterise(parts, camera, size);
  // A step in depth worth a line: about two pixels' worth of the model's own scale.
  outline(frame, 2 / camera.scale);
  triad(frame, camera);

  const out = new Uint8ClampedArray(cell * cell * 3);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            sum += frame.color[((y * SUPERSAMPLE + sy) * size + x * SUPERSAMPLE + sx) * 3 + c];
          }
        }
        out[(y * cell + x) * 3 + c] = Math.round(sum / samples);
      }
    }
  }
  return out;
}

/**
 * Encodes RGB pixels as a PNG.
 *
 * @param {Uint8ClampedArray} rgb Three bytes per pixel, row by row.
 * @param {number} width The width, in pixels.
 * @param {number} height The height, in pixels.
 * @returns {Buffer} The file.
 */
export function encodePng(rgb, width, height) {
  // Every row is prefixed with its filter type; 0 is none, which deflate copes with well
  // enough on flat-shaded images with large areas of one colour.
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }

  /**
   * @param {string} type The chunk's four-letter type.
   * @param {Buffer} data Its contents.
   * @returns {Buffer} The chunk, with its length and checksum.
   */
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // truecolour, no alpha

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Renders parts from one or more views, laid out in a grid, as a PNG.
 *
 * Each view is framed on its own, so a long thin part fills its front view and its top view
 * alike; the views therefore do not share a scale, and the bounding box beside the picture is
 * what to read sizes from.
 *
 * @param {ReadonlyArray<PreviewPart>} parts What to draw.
 * @param {object} [options] How to draw it.
 * @param {ReadonlyArray<string>} [options.views] Which of {@link VIEWS}, in reading order.
 * @param {number} [options.size] The width of the whole image, in pixels.
 * @returns {{ png: Buffer, width: number, height: number, columns: number }} The image, and
 *   how its views are laid out.
 * @throws {Error} If a view is not one of {@link VIEWS}.
 */
export function renderPreview(parts, options = {}) {
  const { views = ['iso'], size = 640 } = options;
  for (const name of views) {
    if (!Object.hasOwn(VIEWS, name)) {
      throw new Error(`no view named "${name}" - use one of ${Object.keys(VIEWS).join(', ')}`);
    }
  }

  const columns = Math.ceil(Math.sqrt(views.length));
  const rows = Math.ceil(views.length / columns);
  const cell = Math.floor(size / columns);
  const width = cell * columns;
  const height = cell * rows;

  const image = new Uint8ClampedArray(width * height * 3);
  for (let p = 0; p < width * height; p++) image.set(BACKGROUND, p * 3);

  for (const [i, name] of views.entries()) {
    const pixels = renderView(parts, name, cell);
    const left = (i % columns) * cell;
    const top = Math.floor(i / columns) * cell;
    for (let y = 0; y < cell; y++) {
      image.set(pixels.subarray(y * cell * 3, (y + 1) * cell * 3), ((top + y) * width + left) * 3);
    }
  }

  // Hairlines between the cells, so a sheet of views does not read as one scene.
  for (let c = 1; c < columns; c++) {
    for (let y = 0; y < height; y++) image.set(DIVIDER, (y * width + c * cell) * 3);
  }
  for (let r = 1; r < rows; r++) {
    for (let x = 0; x < width; x++) image.set(DIVIDER, (r * cell * width + x) * 3);
  }

  return { png: encodePng(image, width, height), width, height, columns };
}
