/**
 * The viewport the demo renders into.
 *
 * A pared-down cousin of the editor's viewer: the same z-up convention and the same edge
 * overlay, but it turns by itself and has no gizmos, because nobody came to this page to
 * operate a CAD tool.
 */

/** @import { RenderedPart } from 'forma-dsl' */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { currentTheme, THEME_EVENT } from './site.js';

/** Angle, in degrees, below which an edge is too shallow to be worth drawing. */
const EDGE_THRESHOLD = 25;

/** Per-theme colours for the plate and the edge overlay. */
const PALETTE = {
  dark: { grid: '#26323f', grid2: '#1a222c', edge: '#0b0e13', key: '#ffffff', ground: '#30384a' },
  light: { grid: '#c9bda6', grid2: '#ded3bd', edge: '#6b5f4a', key: '#fffaf0', ground: '#e0d6c2' },
};

/**
 * The demo's three.js side: one mesh per part, a build plate for scale, and a camera that
 * frames whatever was just solved and then drifts around it.
 */
export class Stage {
  /** @type {Array<{ geometry: THREE.BufferGeometry, material: THREE.Material, edges: THREE.LineSegments }>} */
  #parts = [];

  /** @type {boolean} Whether the canvas is on screen. */
  #onScreen = true;

  /** @type {boolean} Whether a frame is already booked. */
  #looping = false;

  /**
   * @param {HTMLCanvasElement} canvas The canvas to draw into.
   * @param {THREE.WebGLRenderer} [renderer] Where the scene is drawn. A parameter so the
   *   scene graph can be driven without a GPU; constructing the default is what throws
   *   when there is no WebGL, which is the signal the caller catches.
   * @throws {Error} If the browser cannot give the canvas a WebGL context.
   */
  constructor(canvas, renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })) {
    /** @type {HTMLCanvasElement} The canvas being drawn into. */
    this.canvas = canvas;

    /** @type {THREE.WebGLRenderer} The renderer, transparent so the panel shows through. */
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    /** @type {THREE.Scene} The scene. */
    this.scene = new THREE.Scene();

    /** @type {THREE.PerspectiveCamera} The camera. */
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10000);
    // Z up: models are printed, and every shape in the language builds up from z = 0.
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(90, -120, 78);

    /** @type {OrbitControls} Orbit, with the turntable running until someone grabs it. */
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = 0.9;
    // Left alone it keeps turning; touched, it stays where it was put. A background that
    // drifts away from what the reader just aimed at is worse than one that never moved.
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });

    /** @type {THREE.GridHelper} The build plate, rebuilt whenever a model is framed. */
    this.grid = this.#makeGrid(60);
    this.scene.add(this.grid);

    /** @type {THREE.Group} Whatever is currently on screen. */
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.#addLights();
    this.applyTheme();
    addEventListener(THEME_EVENT, () => this.applyTheme());

    this.#followSize();
    this.#watchVisibility();
  }

  /**
   * @returns {void}
   */
  #addLights() {
    /** @type {THREE.HemisphereLight} Keeps the shadowed side of a solid readable. */
    this.ambient = new THREE.HemisphereLight('#ffffff', '#30384a', 2.0);
    this.scene.add(this.ambient);

    /** @type {THREE.DirectionalLight} The key light. */
    this.key = new THREE.DirectionalLight('#ffffff', 2.2);
    this.key.position.set(1, -1.4, 2);
    this.scene.add(this.key);

    /** @type {THREE.DirectionalLight} A cool fill, so the dark side does not go black. */
    this.fill = new THREE.DirectionalLight('#8fb4ff', 0.6);
    this.fill.position.set(-1.5, 1, 0.5);
    this.scene.add(this.fill);
  }

  /**
   * @param {number} extent Half the width the plate should span.
   * @returns {THREE.GridHelper} A build plate lying in the xy plane.
   */
  #makeGrid(extent) {
    const colors = PALETTE[currentTheme()];
    const divisions = Math.max(4, Math.round(extent / 10));
    const grid = new THREE.GridHelper(divisions * 20, divisions * 2, colors.grid, colors.grid2);
    // GridHelper is built in the xz plane; everything here is z-up.
    grid.rotation.x = Math.PI / 2;
    /** @type {THREE.Material} */ (grid.material).transparent = true;
    /** @type {THREE.Material} */ (grid.material).opacity = 0.65;
    return grid;
  }

  /**
   * Repaints the plate, the lights and the edge overlays in the theme now in force.
   *
   * @returns {void}
   */
  applyTheme() {
    const colors = PALETTE[currentTheme()];

    this.scene.remove(this.grid);
    this.grid.dispose();
    this.grid = this.#makeGrid(this.#extent);
    this.scene.add(this.grid);

    this.key.color = new THREE.Color(colors.key);
    this.ambient.groundColor = new THREE.Color(colors.ground);
    for (const part of this.#parts) {
      /** @type {THREE.LineBasicMaterial} */ (part.edges.material).color = new THREE.Color(colors.edge);
    }
    this.#request();
  }

  /** @type {number} Half the width of the last model framed, so the plate can follow it. */
  #extent = 60;

  /**
   * Replaces the scene with a freshly solved set of parts.
   *
   * @param {ReadonlyArray<RenderedPart>} parts The parts to draw.
   * @returns {void}
   */
  show(parts) {
    this.clear();
    const colors = PALETTE[currentTheme()];

    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(part.mesh.normals, 3));

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color),
        metalness: 0.06,
        roughness: 0.52,
        transparent: part.opacity < 1,
        opacity: part.opacity,
      });

      this.group.add(new THREE.Mesh(geometry, material));

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD),
        new THREE.LineBasicMaterial({ color: colors.edge, transparent: true, opacity: 0.32 }),
      );
      this.group.add(edges);

      this.#parts.push({ geometry, material, edges });
    }
    this.#request();
  }

  /**
   * Empties the scene.
   *
   * Geometries and materials are disposed explicitly: they hold GPU buffers that dropping
   * the reference does not release, and the demo replaces its model every few seconds.
   *
   * @returns {void}
   */
  clear() {
    for (const { geometry, material, edges } of this.#parts) {
      geometry.dispose();
      material.dispose();
      edges.geometry.dispose();
      /** @type {THREE.Material} */ (edges.material).dispose();
    }
    this.#parts = [];
    this.group.clear();
  }

  /**
   * Frames whatever is on screen, and resizes the plate to suit it.
   *
   * @returns {void}
   */
  frame() {
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 1);
    const distance = radius / Math.sin((this.camera.fov * Math.PI) / 360);

    this.controls.target.copy(center);
    const direction = new THREE.Vector3(0.62, -0.92, 0.5).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance * 1.32);
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();

    this.#extent = Math.max(size.x, size.y, 20);
    this.scene.remove(this.grid);
    this.grid.dispose();
    this.grid = this.#makeGrid(this.#extent);
    this.scene.add(this.grid);
    this.#request();
  }

  /**
   * Hands the turntable back its own model after someone has been dragging it.
   *
   * @returns {void}
   */
  resumeRotation() {
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * @returns {void}
   */
  #followSize() {
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = this.canvas;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.#request();
    };
    new ResizeObserver(resize).observe(this.canvas);
    resize();
  }

  /**
   * @returns {void}
   */
  #watchVisibility() {
    new IntersectionObserver((entries) => {
      this.#onScreen = entries.some((entry) => entry.isIntersecting);
      this.#request();
    }).observe(this.canvas);
    document.addEventListener('visibilitychange', () => this.#request());
  }

  /**
   * Books a frame, unless one is already booked or there is nobody to see it.
   *
   * @returns {void}
   */
  #request() {
    if (this.#looping || !this.#onScreen || document.hidden) return;
    this.#looping = true;
    requestAnimationFrame(() => this.#tick());
  }

  /**
   * Draws one frame, and books another only while the damping or the turntable still has
   * something to say. An idle stage costs nothing.
   *
   * @returns {void}
   */
  #tick() {
    this.#looping = false;
    if (!this.#onScreen || document.hidden) return;

    const moved = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (moved || this.controls.autoRotate) this.#request();
  }
}
