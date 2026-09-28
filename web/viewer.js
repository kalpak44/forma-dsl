import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/// The three.js side of the preview: one mesh per scene part, a build plate for scale, and
/// a camera that frames whatever was just rendered.
export class Viewer {
  #parts = [];

  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#12161c');

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    this.camera.up.set(0, 0, 1); // Z up: models are printed, and every shape here builds up from z = 0.
    this.camera.position.set(90, -120, 80);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#30384a', 2.0));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(1, -1.4, 2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#8fb4ff', 0.7);
    fill.position.set(-1.5, 1, 0.5);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(200, 20, '#3a4657', '#232b36');
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.edgesVisible = false;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    new ResizeObserver(resize).observe(canvas);
    resize();

    const tick = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(tick);
    };
    tick();
  }

  /// Replaces the scene with a freshly rendered set of parts.
  ///
  /// Geometries and materials are disposed explicitly: they hold GPU buffers that dropping
  /// the reference does not release, and a live editor re-renders on every keystroke.
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
        flatShading: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.name;
      this.group.add(mesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 25),
        new THREE.LineBasicMaterial({ color: '#0d1117', transparent: true, opacity: 0.35 }),
      );
      edges.visible = this.edgesVisible;
      edges.userData.isEdges = true;
      this.group.add(edges);

      this.#parts.push({ geometry, material, edges });
    }
  }

  clear() {
    for (const { geometry, material, edges } of this.#parts) {
      geometry.dispose();
      material.dispose();
      edges.geometry.dispose();
      edges.material.dispose();
    }
    this.#parts = [];
    this.group.clear();
  }

  setEdgesVisible(visible) {
    this.edgesVisible = visible;
    for (const child of this.group.children) {
      if (child.userData.isEdges) child.visible = visible;
    }
  }

  /// Frames the current geometry. Called only when the model's size changes materially, so
  /// that editing a dimension does not yank the camera away from what is being looked at.
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
    this.camera.near = Math.max(distance / 1000, 0.01);
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();

    const extent = Math.max(size.x, size.y, 20);
    const divisions = Math.max(4, Math.round(extent / 10));
    this.scene.remove(this.grid);
    this.grid.dispose?.();
    this.grid = new THREE.GridHelper(divisions * 10 * 2, divisions * 2, '#3a4657', '#232b36');
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
  }
}
