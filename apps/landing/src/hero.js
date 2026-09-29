/**
 * The scene behind the headline.
 *
 * A turntable of machined-looking parts under a receding grid, drawn as matte solids with
 * bright edge overlays — a drawing that happens to be moving, rather than a video. It is
 * plain three.js on purpose: the hero has to be on screen immediately, and the geometry
 * kernel is several megabytes that the demo further down the page can afford to wait for.
 */

import * as THREE from 'three';

import { currentTheme, THEME_EVENT } from './site.js';

/** How far the camera stands from the middle of the turntable. */
const RADIUS = 104;

/** One full pass of the turntable, in seconds. Slow enough to read as drift, not spin. */
const PERIOD = 190;

/** Per-theme colours. The scene is lit to match the page it sits behind, not the other way. */
const PALETTE = {
  dark: {
    solid: '#2c3a51', edge: '#82aaff', accent: '#e9a94b',
    grid: '#223044', fog: '#0b0e13', key: '#c9dcff', ground: '#2a3348',
  },
  light: {
    solid: '#d5c9b1', edge: '#2f5bd0', accent: '#a2680f',
    grid: '#cabfa8', fog: '#f1ece1', key: '#ffffff', ground: '#cdbfa4',
  },
};

/**
 * A rounded rectangular prism, built the way the language builds one: round the profile,
 * then extrude it.
 *
 * @param {number} w Width.
 * @param {number} d Depth.
 * @param {number} h Height.
 * @param {number} r Corner radius.
 * @returns {THREE.ExtrudeGeometry} The prism, centred on its base.
 */
function roundedPrism(w, d, h, r) {
  const shape = new THREE.Shape();
  const x = w / 2;
  const y = d / 2;
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * The parts on the turntable, in the order they are laid out around it.
 *
 * @returns {Array<{ geometry: THREE.BufferGeometry, at: [number, number, number], spin: number, accent: boolean }>}
 *   Each part, with where it stands and how fast it turns on its own axis.
 */
function makeParts() {
  return [
    { geometry: roundedPrism(30, 18, 7, 3), at: [-30, 0, 6], spin: 0.06, accent: false },
    { geometry: new THREE.CylinderGeometry(11, 11, 15, 40, 1, true), at: [14, 8, -22], spin: -0.09, accent: true },
    { geometry: new THREE.TorusGeometry(13, 3.4, 12, 44), at: [34, 13, 16], spin: 0.05, accent: false },
    { geometry: new THREE.CylinderGeometry(9, 9, 6, 6), at: [-8, 5, 30], spin: 0.11, accent: true },
    { geometry: roundedPrism(16, 16, 22, 4), at: [46, 0, -26], spin: -0.04, accent: false },
    { geometry: new THREE.IcosahedronGeometry(8, 0), at: [-44, 9, -18], spin: 0.08, accent: false },
  ];
}

/**
 * The hero background, for the life of the page.
 *
 * Constructing one starts a render loop that pauses whenever the canvas is off screen or
 * the tab is hidden — a landing page has no business holding a GPU while it is not being
 * looked at.
 */
export class Hero {
  /** @type {THREE.Group[]} One group per part: the solid and its edges, turning together. */
  #parts = [];

  /** @type {boolean} Whether the render loop should keep asking for frames. */
  #running = false;

  /** @type {boolean} Whether the canvas is currently intersecting the viewport. */
  #onScreen = false;

  /** @type {boolean} Whether the reader asked for no motion. */
  #reduced = false;

  /**
   * @param {HTMLCanvasElement} canvas The canvas to draw into.
   * @throws {Error} If the browser cannot give the canvas a WebGL context.
   */
  constructor(canvas) {
    /** @type {HTMLCanvasElement} The canvas being drawn into. */
    this.canvas = canvas;

    /** @type {THREE.WebGLRenderer} The renderer. Transparent, so the page paints behind it. */
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Beyond 1.75x costs fill rate on a background nobody is inspecting.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));

    /** @type {THREE.Scene} The scene. */
    this.scene = new THREE.Scene();

    /** @type {THREE.PerspectiveCamera} The camera. */
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 600);
    this.camera.up.set(0, 1, 0);

    /** @type {THREE.Group} Everything that turns. */
    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);

    /** @type {THREE.GridHelper} The ground plane. */
    this.grid = new THREE.GridHelper(520, 52);
    this.grid.position.y = -16;
    this.scene.add(this.grid);

    this.#addParts();
    this.#addLights();
    this.applyTheme();

    addEventListener(THEME_EVENT, () => this.applyTheme());
    this.#followSize();
    this.#watchVisibility();
  }

  /**
   * Builds each part as a matte solid with an edge overlay, which is what makes it read as
   * a drawing rather than as a render.
   *
   * @returns {void}
   */
  #addParts() {
    for (const part of makeParts()) {
      const group = new THREE.Group();
      group.position.set(...part.at);
      group.userData.baseY = part.at[1];
      group.userData.spin = part.spin;

      const solid = new THREE.Mesh(part.geometry, new THREE.MeshStandardMaterial({
        metalness: 0.18, roughness: 0.7, transparent: true, opacity: 0.86, flatShading: true,
      }));
      group.add(solid);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(part.geometry, 22),
        new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 }),
      );
      edges.userData.accent = part.accent;
      group.add(edges);

      this.turntable.add(group);
      this.#parts.push(group);
    }
  }

  /**
   * @returns {void}
   */
  #addLights() {
    /** @type {THREE.HemisphereLight} Keeps the shadowed side of a part readable. */
    this.ambient = new THREE.HemisphereLight('#ffffff', '#2a3348', 1.5);
    this.scene.add(this.ambient);

    /** @type {THREE.DirectionalLight} The key light, which is what gives the parts form. */
    this.key = new THREE.DirectionalLight('#ffffff', 1.9);
    this.key.position.set(2, 3, 1.5);
    this.scene.add(this.key);
  }

  /**
   * Repaints the scene in the theme now in force.
   *
   * @returns {void}
   */
  applyTheme() {
    const colors = PALETTE[currentTheme()];

    this.scene.fog = new THREE.Fog(colors.fog, RADIUS * 0.9, RADIUS * 4.4);
    /** @type {THREE.Material & { color: THREE.Color }} */ (this.grid.material).color = new THREE.Color(colors.grid);
    /** @type {THREE.Material} */ (this.grid.material).transparent = true;
    /** @type {THREE.Material} */ (this.grid.material).opacity = 0.5;
    this.key.color = new THREE.Color(colors.key);
    this.ambient.groundColor = new THREE.Color(colors.ground);

    for (const group of this.#parts) {
      for (const child of group.children) {
        if (child instanceof THREE.Mesh) {
          /** @type {THREE.MeshStandardMaterial} */ (child.material).color = new THREE.Color(colors.solid);
        } else if (child instanceof THREE.LineSegments) {
          /** @type {THREE.LineBasicMaterial} */ (child.material).color =
            new THREE.Color(child.userData.accent ? colors.accent : colors.edge);
        }
      }
    }
  }

  /**
   * Keeps the drawing buffer matched to the canvas, which is sized by CSS rather than by us.
   *
   * @returns {void}
   */
  #followSize() {
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = this.canvas;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      if (w > 900) this.camera.setViewOffset(w, h, Math.round(-w * 0.17), 0, w, h);
      else this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      this.#draw(performance.now());
    };
    new ResizeObserver(resize).observe(this.canvas);
    resize();
  }

  /**
   * Runs the loop only while the canvas is on screen and the tab is in front.
   *
   * @returns {void}
   */
  #watchVisibility() {
    const update = () => {
      const wanted = this.#onScreen && !document.hidden;
      if (wanted === this.#running) return;
      this.#running = wanted;
      if (wanted) requestAnimationFrame((t) => this.#tick(t));
    };

    new IntersectionObserver((entries) => {
      this.#onScreen = entries.some((entry) => entry.isIntersecting);
      update();
    }).observe(this.canvas);

    document.addEventListener('visibilitychange', update);

    // One frame is the whole animation for a reader who asked not to be moved; the parts
    // are still laid out, lit and drawn, they simply stay put.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.#reduced = true;
      this.#draw(0);
    }
    this.canvas.classList.add('ready');
  }

  /**
   * @param {number} time Milliseconds since the page loaded, from the frame callback.
   * @returns {void}
   */
  #tick(time) {
    if (!this.#running || this.#reduced) return;
    this.#draw(time);
    requestAnimationFrame((next) => this.#tick(next));
  }

  /**
   * Places the camera and the parts for one instant, and draws it.
   *
   * @param {number} time Milliseconds since the page loaded.
   * @returns {void}
   */
  #draw(time) {
    const t = (time / 1000) * ((Math.PI * 2) / PERIOD);

    this.camera.position.set(
      Math.cos(t) * RADIUS * 1.5,
      26 + Math.sin(t * 2.1) * 7,
      Math.sin(t) * RADIUS * 1.5,
    );
    this.camera.lookAt(0, 4, 0);

    for (const group of this.#parts) {
      group.rotation.y = t * group.userData.spin * 26;
      // Absolute, not cumulative: `+=` here drifts the whole turntable upwards.
      group.position.y = group.userData.baseY + Math.sin(t * 9 + group.position.x) * 1.4;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
