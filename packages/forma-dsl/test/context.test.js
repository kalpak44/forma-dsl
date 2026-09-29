import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, EvaluationContext, GeometryNode } from '../src/index.js';

/// A model whose sphere is fixed and whose cylinder is not, so an edit to the radius
/// changes exactly three nodes: the cylinder, the translate above it, and the union.
const twoPart = (radius) => `model "m" {
  union {
    sphere { radius = 5  segments = 64 }
    translate { offset = [30, 0, 0]  cylinder { radius = ${radius}  height = 4  segments = 16 } }
  }
}`;

test('a reused context evaluates nothing twice for an unchanged document', async () => {
  const context = await EvaluationContext.create();
  const source = 'model "m" { difference { box { size = [10, 10, 10] }  sphere { radius = 6  segments = 32 } } }';

  await render(source, { context });
  const afterFirst = context.stats.evaluated;
  assert.ok(afterFirst > 0, 'the first render evaluated nothing');

  await render(source, { context });
  assert.equal(context.stats.evaluated, afterFirst, 'the second render evaluated new nodes');

  context.dispose();
});

test('a reused context re-evaluates only the subtree an edit changed', async () => {
  const context = await EvaluationContext.create();

  await render(twoPart(2), { context });
  const afterFirst = context.stats.evaluated;

  await render(twoPart(3), { context });
  const added = context.stats.evaluated - afterFirst;

  // The sphere is untouched by the edit, so it must come from the cache.
  assert.equal(added, 3, `expected 3 new evaluations, got ${added}`);

  context.dispose();
});

test('collect frees what the current tree can no longer reach', async () => {
  const context = await EvaluationContext.create();

  await render('model "m" { sphere { radius = 5  segments = 32 } }', { context });
  const afterSphere = context.size;
  assert.ok(afterSphere > 0);

  const second = await render('model "m" { box { size = [4, 4, 4] } }', { context });
  assert.ok(context.size > afterSphere, 'the second render should have added entries');

  const roots = second.parts.map((part) => part.node);
  const freed = context.collect(roots, { keep: 0 });

  assert.ok(freed > 0, 'nothing was freed');
  assert.equal(context.size, roots.length, 'only the live tree should remain');
  // The surviving solid is still usable, which is the point of collecting rather than disposing.
  assert.ok(second.parts[0].concrete.volume() > 0);

  context.dispose();
});

test('collect keeps a tail, so an undone edit still hits the cache', async () => {
  const context = await EvaluationContext.create();

  const first = await render(twoPart(2), { context });
  context.collect(first.parts.map((part) => part.node));

  const second = await render(twoPart(3), { context });
  // The default tail is far larger than this tree, so nothing should have been released.
  assert.equal(context.collect(second.parts.map((part) => part.node)), 0);

  const before = context.stats.evaluated;
  await render(twoPart(2), { context });
  assert.equal(context.stats.evaluated, before, 'going back to the first radius re-evaluated');

  context.dispose();
});

test('a disposed context refuses further work and tolerates a second dispose', async () => {
  const context = await EvaluationContext.create();
  const result = await render('model "m" { box { size = 2 } }', { context });
  const node = result.parts[0].node;

  context.dispose();
  assert.equal(context.disposed, true);
  assert.equal(context.size, 0);

  context.dispose(); // idempotent
  assert.equal(context.collect([node]), 0, 'collect on a disposed context should be a no-op');
  await assert.rejects(context.evaluate(node), /disposed/);
});

test('a result landing after disposal is freed rather than cached', async () => {
  const context = await EvaluationContext.create();
  const node = GeometryNode.shape(3, 'sphere', { radius: 4, segments: 64 });

  const pending = context.evaluate(node);
  context.dispose();
  await pending; // the evaluation was already in flight when the context went away

  assert.equal(context.size, 0, 'a late result must not repopulate a disposed cache');
});

test('render leaves a borrowed context alive when it fails', async () => {
  const context = await EvaluationContext.create();

  await assert.rejects(render('model "m" { union { box { size = 1 }  circle { radius = 1 } } }', { context }));
  assert.equal(context.disposed, false, 'a caller-supplied context must survive a failed render');

  const ok = await render('model "m" { box { size = 3 } }', { context });
  assert.ok(ok.parts[0].concrete.volume() > 0);

  context.dispose();
});
