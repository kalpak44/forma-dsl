import { test } from 'node:test';
import assert from 'node:assert/strict';

import { render } from 'forma-dsl';

import { EXAMPLES } from '../src/examples.js';

// The examples are the editor's content, so this lives with them rather than with the
// library: it asserts that what the editor ships still renders against the library it
// depends on, which is exactly the seam a version bump can break.
test('every shipped example renders', async () => {
  for (const [name, source] of Object.entries(EXAMPLES)) {
    const r = await render(source);
    assert.ok(r.parts.length > 0, `${name} produced no parts`);
    for (const part of r.parts) {
      assert.ok(part.mesh.triangleCount > 0, `${name}: part "${part.name}" is empty`);
      assert.ok(part.concrete.volume() > 0, `${name}: part "${part.name}" has no volume`);
    }
    r.context.dispose();
  }
});
