import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Program, Evaluator, parse, tokenize, FormaError, render } from '../src/index.js';
import { GeometryNode } from '../src/core/node.js';
import { Transform } from '../src/values/transform.js';
import { DigestWriter } from '../src/core/digest.js';

const evaluate = (source) => {
  const program = Program.parse(`model "m" { box { size = 1 } }`);
  const evaluator = new Evaluator(program, {});
  return evaluator.expression(parse(`model "m" { box { size = ${source} } }`)
    .declarations[0].body.blocks[0].body.attributes[0].value, evaluator.root);
};

test('digest is stable and content-addressed', () => {
  const a = new DigestWriter().string('x').number(1.5).finish();
  const b = new DigestWriter().string('x').number(1.5).finish();
  assert.equal(a, b);
  assert.equal(a.length, 32);
  assert.notEqual(a, new DigestWriter().string('x').number(1.5000001).finish());
  // -0 and 0 are the same number to a model but different IEEE bit patterns.
  assert.equal(new DigestWriter().number(0).finish(), new DigestWriter().number(-0).finish());
});

test('identical subtrees share a node identity', () => {
  const a = GeometryNode.shape(3, 'box', { size: [1, 2, 3], center: false });
  const b = GeometryNode.shape(3, 'box', { size: [1, 2, 3], center: false });
  assert.equal(a.digest, b.digest);
  // Attribute order must not matter, or the cache misses on a reordered block.
  assert.equal(
    GeometryNode.shape(3, 'box', { size: [1], center: true }).digest,
    GeometryNode.shape(3, 'box', { center: true, size: [1] }).digest,
  );
});

test('union is order independent but difference is not', () => {
  const a = GeometryNode.shape(3, 'box', { size: [1, 1, 1] });
  const b = GeometryNode.shape(3, 'sphere', { radius: 1, segments: 8 });
  assert.equal(GeometryNode.union([a, b]).digest, GeometryNode.union([b, a]).digest);
  assert.notEqual(GeometryNode.difference([a, b]).digest, GeometryNode.difference([b, a]).digest);
});

test('nested transforms collapse into one matrix', () => {
  let node = GeometryNode.shape(3, 'box', { size: [1, 1, 1] });
  for (let i = 0; i < 5; i++) {
    node = GeometryNode.transformed(node, Transform.translation([1, 0, 0], 3));
  }
  assert.equal(node.subtreeSize, 2, 'five stacked transforms should leave one transform node');
  assert.equal(node.props.transform.at(0, 3), 5, 'the five translations should have summed');
});

test('lexer records line breaks so attributes terminate', () => {
  const tokens = tokenize('a = 1\n-2');
  const minus = tokens.find((t) => t.value === '-');
  assert.equal(minus.nlBefore, true);
});

test('a newline ends an attribute, brackets do not', () => {
  const doc = parse('model "m" {\n  box {\n    size = [1,\n2,\n3]\n    center = true\n  }\n}');
  const attributes = doc.declarations[0].body.blocks[0].body.attributes;
  assert.deepEqual(attributes.map((a) => a.name), ['size', 'center']);
});

test('expressions: arithmetic, vectors, comparison, conditionals', () => {
  assert.equal(evaluate('1 + 2 * 3'), 7);
  assert.equal(evaluate('(1 + 2) * 3'), 9);
  assert.deepEqual(evaluate('[1,2,3] * 2'), [2, 4, 6]);
  assert.deepEqual(evaluate('[1,2] + [3,4]'), [4, 6]);
  assert.equal(evaluate('[1,2,3].y'), 2);
  assert.equal(evaluate('2 > 1 ? 10 : 20'), 10);
  assert.equal(evaluate('max(1, 5, 3)'), 5);
  assert.deepEqual(evaluate('range(0, 3)'), [0, 1, 2]);
  assert.equal(evaluate('"a${1+1}b"'), 'a2b');
  assert.equal(evaluate('sin(90)'), 1);
});

test('short-circuit avoids evaluating the dead side', () => {
  assert.equal(evaluate('false && [1][5].nope'), false);
  assert.equal(evaluate('true || [1][5].nope'), true);
});

test('errors carry a source position', () => {
  assert.throws(() => Program.parse('model "m" { box { size = }'), (error) => {
    assert.ok(error instanceof FormaError);
    assert.ok(error.loc.line >= 1);
    return true;
  });
});

test('range is bounded, and a backwards range is empty rather than infinite', () => {
  assert.deepEqual(evaluate('range(0, 10, -1)'), []);
  assert.throws(() => evaluate('range(0, 200000)'), /100000/);
  assert.throws(() => evaluate('range(0, 10, 0)'), /step cannot be 0/);
});

test('division by zero is an error, not Infinity', () => {
  assert.throws(() => evaluate('1 / 0'), /division by zero/);
});

test('a budget refuses a document that asks for more geometry than it allows', async () => {
  const source = `model "m" {
    for i in range(0, 40) {
      for j in range(0, 40) {
        translate { offset = [i, j, 0]  box { size = 1 } }
      }
    }
  }`;

  await assert.rejects(
    () => render(source, { maxNodes: 100 }),
    (error) => error instanceof FormaError
      && /more than 100 blocks built/.test(error.message)
      && error.loc?.line > 0,
  );
});

test('no budget is the default, so an existing render is unchanged', async () => {
  const source = 'model "m" { for i in range(0, 20) { translate { offset = [i, 0, 0]  box { size = 1 } } } }';
  const r = await render(source);
  assert.equal(r.parts.length, 1);
  r.context.dispose();
});

test('a budget large enough to hold the document does not fire', async () => {
  const source = 'model "m" { for i in range(0, 5) { translate { offset = [i, 0, 0]  box { size = 1 } } } }';
  const r = await render(source, { maxNodes: 10_000 });
  assert.equal(r.parts.length, 1);
  r.context.dispose();
});

test('an already-aborted signal stops the render with the caller reason', async () => {
  const controller = new AbortController();
  controller.abort(new Error('superseded'));

  await assert.rejects(
    () => render('model "m" { box { size = 10 } }', { signal: controller.signal }),
    /superseded/,
  );
});

test('a signal that never fires leaves the render alone', async () => {
  const controller = new AbortController();
  const r = await render('model "m" { box { size = 10 } }', { signal: controller.signal });
  assert.equal(r.parts.length, 1);
  r.context.dispose();
});
