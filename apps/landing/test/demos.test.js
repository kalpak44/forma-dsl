import { test } from 'node:test';
import assert from 'node:assert/strict';

import { render, describeParameters } from 'forma-dsl';

import { DEMOS } from '../src/demos.js';

// The demo is the landing page's whole argument: the document you watch being typed is
// compiled in front of you. A demo that no longer renders would turn the page's claim into
// an error message, so it is asserted here against the library the page actually ships with.
test('every demo renders, and quickly enough to watch', async () => {
  for (const demo of DEMOS) {
    const started = performance.now();
    const result = await render(demo.source);
    const elapsed = performance.now() - started;

    assert.ok(result.parts.length > 0, `${demo.name} produced no parts`);
    for (const part of result.parts) {
      assert.ok(part.mesh.triangleCount > 0, `${demo.name}: part "${part.name}" is empty`);
      assert.ok(part.concrete.volume() > 0, `${demo.name}: part "${part.name}" has no volume`);
    }
    // Generous: this is a floor against someone pasting in a 200-segment lathe, not a
    // benchmark. A demo slower than this reads as a hung page rather than a live one.
    assert.ok(elapsed < 2500, `${demo.name} took ${Math.round(elapsed)}ms to solve`);

    result.context.dispose();
  }
});

test('the parameters a demo declares are readable without rendering', () => {
  for (const demo of DEMOS) {
    // Not every demo takes parameters; the ones that do must describe them, since that is
    // the feature the caption is pointing at.
    assert.ok(Array.isArray(describeParameters(demo.source)), `${demo.name} has no parameter list`);
  }
});
