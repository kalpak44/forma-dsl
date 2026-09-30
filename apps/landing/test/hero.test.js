import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { createPage } from './dom.js';
import { fakeRenderer } from './renderer.js';
import { Hero } from '../src/hero.js';

/** The query the hero asks about, spelled exactly as it asks it. */
const MOTION = '(prefers-reduced-motion: reduce)';

/**
 * @param {object} [options] Overrides.
 * @param {boolean} [options.reduced] Whether the reader asked for no motion.
 * @param {number} [options.width] The canvas width.
 * @returns {{ page: ReturnType<typeof createPage>, canvas: HTMLCanvasElement,
 *   renderer: ReturnType<typeof fakeRenderer>, hero: Hero }} A hero on a sized canvas.
 */
function mounted({ reduced = false, width = 1200 } = {}) {
  const page = createPage('<!doctype html><html><body><canvas id="hero"></canvas></body></html>');
  page.media(MOTION, reduced);
  const canvas = /** @type {HTMLCanvasElement} */ (page.document.getElementById('hero'));
  page.size(canvas, width, 600);
  const renderer = fakeRenderer();
  return { page, canvas, renderer, hero: new Hero(canvas, renderer) };
}

test('the turntable is built, lit and sized, and the canvas is marked ready', () => {
  const { canvas, renderer, hero } = mounted();

  assert.equal(hero.turntable.children.length, 6);
  for (const group of hero.turntable.children) {
    // Each part is a matte solid with its own edge overlay, which is what makes it read
    // as a drawing rather than as a render.
    assert.equal(group.children.filter((child) => child instanceof THREE.Mesh).length, 1);
    assert.equal(group.children.filter((child) => child instanceof THREE.LineSegments).length, 1);
  }

  // Capped at 1.75: the default is drawn from a screen that reports more than that.
  assert.equal(renderer.pixelRatio, 1.75);
  assert.deepEqual(renderer.size, [1200, 600]);
  assert.equal(canvas.classList.contains('ready'), true);
});

test('a wide canvas is offset so the parts clear the headline, a narrow one is not', () => {
  assert.notEqual(mounted({ width: 1200 }).hero.camera.view, null);
  assert.equal(mounted({ width: 800 }).hero.camera.view, null);
});

test('a canvas with no size yet is left alone', () => {
  const { page, canvas, renderer } = mounted();
  page.size(canvas, 0, 0);
  page.resize(canvas);
  assert.deepEqual(renderer.size, [1200, 600]);
});

test('the loop runs only while the canvas is on screen and the tab is in front', () => {
  const { page, canvas, renderer } = mounted();
  assert.equal(renderer.frames, 1, 'the first resize draws a frame');

  // Nothing is booked until the canvas is reported on screen.
  page.frames(3);
  assert.equal(renderer.frames, 1);

  page.intersect(canvas, true);
  page.frames(3);
  assert.equal(renderer.frames, 4);

  page.hide(true);
  document.dispatchEvent(new Event('visibilitychange'));
  const hidden = renderer.frames;
  page.frames(3);
  assert.equal(renderer.frames, hidden);

  page.hide(false);
  document.dispatchEvent(new Event('visibilitychange'));
  page.frames(2);
  assert.ok(renderer.frames > hidden);

  page.intersect(canvas, false);
  const gone = renderer.frames;
  page.frames(3);
  assert.equal(renderer.frames, gone);
});

test('no motion means one frame, laid out and lit, and then stillness', () => {
  const { page, canvas, renderer, hero } = mounted({ reduced: true });
  const placed = hero.camera.position.clone();

  page.intersect(canvas, true);
  page.frames(5);
  assert.equal(renderer.frames, 2, 'the resize and the single still frame');
  assert.deepEqual(hero.camera.position.toArray(), placed.toArray());
});

test('the camera orbits and the parts bob without drifting away', () => {
  const { page, canvas, hero } = mounted();
  page.intersect(canvas, true);

  page.frames(1, 0);
  const start = hero.camera.position.clone();
  const heights = hero.turntable.children.map((group) => group.position.y);

  page.frames(1, 40_000);
  assert.notDeepEqual(hero.camera.position.toArray(), start.toArray());
  assert.ok(Math.abs(hero.camera.position.length() - start.length()) < 20);

  // Absolute rather than cumulative: `+=` here would walk the whole turntable upwards.
  for (const [index, group] of hero.turntable.children.entries()) {
    assert.ok(Math.abs(group.position.y - heights[index]) <= 2.9);
  }
});

test('a theme change repaints the fog, the plate, the solids and the edges', () => {
  const { hero } = mounted();
  const solid = /** @type {THREE.Mesh} */ (hero.turntable.children[0].children[0]);
  const edges = /** @type {THREE.LineSegments} */ (hero.turntable.children[0].children[1]);
  const before = {
    fog: /** @type {THREE.Fog} */ (hero.scene.fog).color.getHexString(),
    solid: /** @type {THREE.MeshStandardMaterial} */ (solid.material).color.getHexString(),
    edge: /** @type {THREE.LineBasicMaterial} */ (edges.material).color.getHexString(),
  };

  document.documentElement.dataset.theme = 'light';
  dispatchEvent(new CustomEvent('forma:theme', { detail: 'light' }));

  assert.notEqual(/** @type {THREE.Fog} */ (hero.scene.fog).color.getHexString(), before.fog);
  const solidMaterial = /** @type {THREE.MeshStandardMaterial} */ (solid.material);
  assert.notEqual(solidMaterial.color.getHexString(), before.solid);
  assert.notEqual(/** @type {THREE.LineBasicMaterial} */ (edges.material).color.getHexString(), before.edge);
});

test('the accented parts are drawn in a different colour from the rest', () => {
  const { hero } = mounted();
  const colours = new Set(hero.turntable.children.map((group) => {
    const edges = /** @type {THREE.LineSegments} */ (group.children[1]);
    return /** @type {THREE.LineBasicMaterial} */ (edges.material).color.getHexString();
  }));
  assert.equal(colours.size, 2);
});
