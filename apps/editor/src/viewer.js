/** @import { RenderedPart } from 'forma-dsl' */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** Angle, in degrees, below which an edge is too shallow to be worth drawing. */
const EDGE_THRESHOLD = 25;

/** The build plate's nominal size before any model has been framed. */
const DEFAULT_GRID_EXTENT = 200;

/**
 * The three.js side of the preview: one mesh per scene part, a build plate for scale, and a
 * camera that frames whatever was just rendered.
 *
 * Constructing one starts a render loop that runs for the life of the page.
 */
export class Viewer {
  /**
   * @type {Array<{ geometry: THREE.BufferGeometry, material: THREE.Material, edges: THREE.LineSegments }>}
   *   What the last {@link Viewer#show} put on screen, kept so it can be disposed.
   */
  #parts = [];

  /**
   * @param {HTMLCanvasElement} canvas The canvas to draw into.
   * @throws {Error} If the browser cannot give the canvas a WebGL context.
   */
  constructor(canvas) {
    /** @type {THREE.WebGLRenderer} The renderer. */
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Retina is worth it; beyond 2x costs fill rate for nothing anyone can see.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    /** @type {THREE.Scene} The scene. */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#12161c');

    /** @type {THREE.PerspectiveCamera} The camera. */
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    // Z up: models are printed, and every shape here builds up from z = 0.
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(90, -120, 80);

    /** @type {OrbitControls} The orbit controls. */
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    /** @type {THREE.GridHelper} The build plate, rebuilt whenever the model is reframed. */
    this.grid = this.#makeGrid(DEFAULT_GRID_EXTENT / 2);
    this.scene.add(this.grid);

    /** @type {THREE.Group} Everything the current model put on screen. */
    this.group = new THREE.Group();
    this.scene.add(this.group);

    /** @type {boolean} Whether edge overlays are currently shown. */
    this.edgesVisible = false;

    this.#addLights();
    this.#followCanvasSize(canvas);
    this.#startRenderLoop();
  }

  /**
   * Three lights rather than one: a key for form, a cool fill so the shadowed side does not
   * go black, and a hemisphere to keep the whole model readable while it is being rotated.
   *
   * @returns {void}
   */
  #addLights() {
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#30384a', 2.0));

    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(1, -1.4, 2);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#8fb4ff', 0.7);
    fill.position.set(-1.5, 1, 0.5);
    this.scene.add(fill);
  }

  /**
   * Keeps the drawing buffer and the camera's aspect matched to the canvas.
   *
   * A ResizeObserver rather than a window resize listener, because the canvas is in a grid
   * that can change size without the window doing anything.
   *
   * @param {HTMLCanvasElement} canvas The canvas to watch.
   * @returns {void}
   */
  #followCanvasSize(canvas) {
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();
  }

  /**
   * Draws continuously, which is what the damped orbit controls need to coast to a stop.
   *
   * @returns {void}
   */
  #startRenderLoop() {
    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  /**
   * @param {number} extent Half the width the plate should span.
   * @returns {THREE.GridHelper} A build plate lying in the xy plane.
   */
  #makeGrid(extent) {
    const divisions = Math.max(4, Math.round(extent / 10));
    const grid = new THREE.GridHelper(divisions * 20, divisions * 2, '#3a4657', '#232b36');
    // GridHelper is built in the xz plane; the models here are all z-up.
    grid.rotation.x = Math.PI / 2;
    return grid;
  }

  /**
   * Replaces the scene with a freshly rendered set of parts.
   *
   * @param {ReadonlyArray<RenderedPart>} parts The parts to draw.
   * @returns {void}
   */
  show(parts) {
    this.clear();
    for (const part of parts) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(part.mesh.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(part.mesh.normals, 3));

      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color),
        metalness: 0.05,
        roughness: 0.55,
        transparent: part.opacity < 1,
        opacity: part.opacity,
        // The mesh already carries per-face normals, so smooth shading still reads as faceted
        // where the model is faceted, and stays smooth where it is not.
        flatShading: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.name;
      this.group.add(mesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, EDGE_THRESHOLD),
        new THREE.LineBasicMaterial({ color: '#0d1117', transparent: true, opacity: 0.35 }),
      );
      edges.visible = this.edgesVisible;
      edges.userData.isEdges = true;
      this.group.add(edges);

      this.#parts.push({ geometry, material, edges });
    }
  }

  /**
   * Empties the scene.
   *
   * Geometries and materials are disposed explicitly: they hold GPU buffers that dropping
   * the reference does not release, and a live editor re-renders on every keystroke.
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
   * @param {boolean} visible Whether to draw the edge overlays.
   * @returns {void}
   */
  setEdgesVisible(visible) {
    this.edgesVisible = visible;
    for (const child of this.group.children) {
      if (child.userData.isEdges) child.visible = visible;
    }
  }

  /**
   * Frames the current geometry, and resizes the build plate to suit it.
   *
   * Called only when the model's size changes materially, so that editing a dimension does
   * not yank the camera away from what is being looked at.
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
    const direction = new THREE.Vector3(0.6, -0.9, 0.55).normalize();
    this.camera.position.copy(center).addScaledVector(direction, distance * 1.25);
    // Clipping planes follow the model's size, or a large part disappears into the far
    // plane and a small one into z-fighting.
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();

    this.scene.remove(this.grid);
    this.grid.dispose();
    this.grid = this.#makeGrid(Math.max(size.x, size.y, 20));
    this.scene.add(this.grid);
  }
}
