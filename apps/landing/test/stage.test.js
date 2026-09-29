import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { createPage } from './dom.js';
import { fakeRenderer } from './renderer.js';
import { Stage } from '../src/stage.js';

/** The query the stage asks about, spelled exactly as it asks it. */
const MOTION = '(prefers-reduced-motion: reduce)';

/**
 * A part shaped like a solved one, without solving anything: the stage reads the buffers,
 * the colour and the opacity, and nothing else.
 *
 * @param {object} [options] Overrides.
 * @param {string} [options.color] The part colour.
 * @param {number} [options.opacity] Its opacity.
 * @param {number} [options.scale] How far the corner sits from the origin.
 * @returns {object} A part the stage can draw.
 */
function part({ color = '#8899aa', opacity = 1, scale = 10 } = {}) {
  const positions = new Float32Array([0, 0, 0, scale, 0, 0, 0, scale, 0, 0, 0, scale]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return { name: 'p', color, opacity, mesh: { positions, normals, triangleCount: 1 } };
}

/**
 * @param {boolean} [reduced] Whether the reader asked for no motion.
 * @returns {{ page: ReturnType<typeof createPage>, canvas: HTMLCanvasElement,
 *   renderer: ReturnType<typeof fakeRenderer>, stage: Stage }} A stage on a sized canvas.
 */
function mounted(reduced = false) {
  const page = createPage('<!doctype html><html><body><canvas id="stage"></canvas></body></html>');
  page.media(MOTION, reduced);
  const canvas = /** @type {HTMLCanvasElement} */ (page.document.getElementById('stage'));
  page.size(canvas, 800, 400);
  const renderer = fakeRenderer();
  return { page, canvas, renderer, stage: new Stage(canvas, renderer) };
}

test('the scene is z-up, sized to the canvas, and drawn once it is on screen', () => {
  const { page, canvas, renderer, stage } = mounted();

  assert.deepEqual(stage.camera.up.toArray(), [0, 0, 1]);
  // Capped at 2: the default is drawn from a screen that reports more than that.
  assert.equal(renderer.pixelRatio, 2);
  assert.deepEqual(renderer.size, [800, 400]);
  assert.equal(stage.camera.aspect, 2);
  assert.equal(stage.controls.autoRotate, true);

  // On screen until the observer says otherwise, so the first model paints without
  // waiting to be told that a canvas the page just laid out is visible.
  page.frames();
  assert.equal(renderer.frames, 1);

  page.intersect(canvas, true);
  page.frames();
  assert.equal(renderer.frames, 2);
});

test('a reader who asked for no motion gets no turntable', () => {
  const { stage } = mounted(true);
  assert.equal(stage.controls.autoRotate, false);
});

test('taking hold of it stops the turntable, and it can be handed back', () => {
  const { stage } = mounted();
  stage.controls.dispatchEvent({ type: 'start' });
  assert.equal(stage.controls.autoRotate, false);

  stage.resumeRotation();
  assert.equal(stage.controls.autoRotate, true);
});

test('showing parts adds a solid and an edge overlay for each, and replaces the last set', () => {
  const { stage } = mounted();

  stage.show([part(), part({ opacity: 0.4 })]);
  assert.equal(stage.group.children.length, 4);

  const solids = stage.group.children.filter((child) => child instanceof THREE.Mesh);
  assert.equal(solids.length, 2);
  assert.equal(/** @type {THREE.MeshStandardMaterial} */ (solids[0].material).transparent, false);
  assert.equal(/** @type {THREE.MeshStandardMaterial} */ (solids[1].material).transparent, true);
  assert.equal(stage.group.children.filter((child) => child instanceof THREE.LineSegments).length, 2);

  stage.show([part()]);
  assert.equal(stage.group.children.length, 2);

  stage.clear();
  assert.equal(stage.group.children.length, 0);
});

test('framing puts the camera outside the model and resizes the plate', () => {
  const { stage } = mounted();
  const before = stage.camera.position.clone();
  const plate = stage.grid;

  stage.show([part({ scale: 40 })]);
  stage.frame();

  assert.notDeepEqual(stage.camera.position.toArray(), before.toArray());
  assert.ok(stage.camera.position.distanceTo(stage.controls.target) > 40);
  assert.ok(stage.camera.far > stage.camera.near);
  // The plate is rebuilt to suit what was framed rather than kept at its starting size.
  assert.notEqual(stage.grid, plate);
});

test('framing an empty scene leaves the camera where it was', () => {
  const { stage } = mounted();
  const before = stage.camera.position.clone();
  stage.frame();
  assert.deepEqual(stage.camera.position.toArray(), before.toArray());
});

test('a theme change repaints the plate and the edges', () => {
  const { stage } = mounted();
  stage.show([part()]);
  const plate = stage.grid;
  const edges = /** @type {THREE.LineSegments} */ (
    stage.group.children.find((child) => child instanceof THREE.LineSegments));
  const dark = /** @type {THREE.LineBasicMaterial} */ (edges.material).color.getHexString();

  document.documentElement.dataset.theme = 'light';
  dispatchEvent(new CustomEvent('forma:theme', { detail: 'light' }));

  assert.notEqual(stage.grid, plate);
  assert.notEqual(/** @type {THREE.LineBasicMaterial} */ (edges.material).color.getHexString(), dark);
});

test('a resize follows the canvas, and a canvas with no size is left alone', () => {
  const { page, canvas, renderer, stage } = mounted();

  page.size(canvas, 600, 300);
  page.resize(canvas);
  assert.deepEqual(renderer.size, [600, 300]);
  assert.equal(stage.camera.aspect, 2);

  page.size(canvas, 0, 0);
  page.resize(canvas);
  assert.deepEqual(renderer.size, [600, 300]);
});

test('nothing is drawn for a canvas off screen or a tab in the background', () => {
  const { page, canvas, renderer, stage } = mounted();
  page.intersect(canvas, true);
  page.frames();
  const drawn = renderer.frames;

  page.intersect(canvas, false);
  stage.show([part()]);
  page.frames(3);
  assert.equal(renderer.frames, drawn);

  page.intersect(canvas, true);
  page.hide(true);
  document.dispatchEvent(new Event('visibilitychange'));
  page.frames(3);
  assert.equal(renderer.frames, drawn);

  page.hide(false);
  document.dispatchEvent(new Event('visibilitychange'));
  page.frames();
  assert.ok(renderer.frames > drawn);
});

test('the turntable keeps booking frames, and an idle stage stops', () => {
  const { page, canvas, renderer } = mounted(true);
  page.intersect(canvas, true);
  page.frames(4);
  // Damping settles and the turntable is off, so the loop lets go rather than spinning.
  const settled = renderer.frames;
  page.frames(4);
  assert.equal(renderer.frames, settled);
});
