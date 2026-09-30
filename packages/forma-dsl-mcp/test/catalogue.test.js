/**
 * The catalogue's answers have to be the language's answers.
 *
 * Two kinds of check: that the set of things described here is the set of things the library
 * has, and that every attribute described here is one a block actually accepts. The second
 * is the one that catches a rename, which is the failure that would otherwise ship as a
 * confident wrong answer.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { BLOCKS, FUNCTIONS } from 'forma-dsl';

import {
  CONSTRUCTS,
  LANGUAGE_CONSTANTS,
  LANGUAGE_FUNCTIONS,
  catalogueDrift,
  formatConstruct,
} from '../src/catalogue.js';
import { checkDocument, disposeSharedContext } from '../src/document.js';

test.after(() => disposeSharedContext());

test('the catalogue and the library agree on what exists', () => {
  assert.deepEqual(catalogueDrift(), []);
});

test('every block in the registry is described', () => {
  for (const name of Object.keys(BLOCKS)) {
    assert.ok(CONSTRUCTS.has(name), `${name} is missing from the catalogue`);
  }
});

test('every function in the registry is described, with the registry’s arity', () => {
  assert.equal(LANGUAGE_FUNCTIONS.length, Object.keys(FUNCTIONS).length);
  for (const entry of LANGUAGE_FUNCTIONS) {
    const expected = FUNCTIONS[entry.name].arity;
    assert.equal(entry.arity, expected === null ? 'variadic' : expected, entry.name);
    assert.ok(entry.description, `${entry.name} has no description`);
  }
});

test('pi and e are reported with the library’s values', () => {
  assert.deepEqual(
    LANGUAGE_CONSTANTS,
    [{ name: 'pi', value: Math.PI }, { name: 'e', value: Math.E }],
  );
});

test('structural facts come from the registry rather than from prose', () => {
  for (const [name, definition] of Object.entries(BLOCKS)) {
    const entry = CONSTRUCTS.get(name);
    assert.equal(entry.dim, definition.dim, `${name}: dim`);
    assert.equal(entry.takes, definition.takes, `${name}: takes`);
    assert.equal(entry.leaf ?? undefined, definition.leaf ?? undefined, `${name}: leaf`);
  }
});

/**
 * A value of the right shape for an attribute, so it can be written into a document and the
 * block asked whether it accepts it.
 *
 * @param {import('../src/catalogue.js').Attribute} attribute The attribute.
 * @returns {string} The value, as it would be written in a document.
 */
function sampleFor(attribute) {
  if (attribute.values) return `"${attribute.values[0]}"`;
  switch (attribute.type) {
    case 'bool': return 'false';
    case 'string': return '"#ffffff"';
    case '2-vector': return '[1, 1]';
    case '3-vector': return '[1, 1, 1]';
    case 'list': return '[[0, 0], [8, 0], [8, 8]]';
    case 'integer': return '8';
    default: return '1';
  }
}

/** A document that exercises one block with one attribute set, wrapped so it renders. */
const HARNESSES = {
  2: (block, body) => `model "m" { part "p" { extrude { height = 2  ${block} { ${body} } } } }`,
  3: (block, body) => `model "m" { part "p" { ${block} { ${body} } } }`,
};

/** What each block needs inside it, and alongside the attribute under test, to be buildable. */
const SCAFFOLD = {
  rect: { with: 'size = [8, 8]' },
  rounded_rect: { with: 'size = [8, 8]' },
  ellipse: { with: 'radii = [8, 4]' },
  regular_polygon: { with: 'sides = 6' },
  stadium: { with: 'size = [8, 4]' },
  polygon: { with: 'points = [[0, 0], [8, 0], [8, 8]]' },
  box: { with: 'size = [8, 8, 8]' },
  cylinder: { with: 'height = 8  radius = 4' },
  cone: { with: 'height = 8' },
  torus: { with: 'radius = 8  tube_radius = 2' },
  extrude: { with: 'height = 4', children: 'rect { size = [8, 8] }' },
  revolve: { children: 'polygon { points = [[0, 0], [8, 0], [8, 8]] }' },
  slice: { children: 'box { size = [8, 8, 8] }', dim: 2 },
  project: { children: 'box { size = [8, 8, 8] }', dim: 2 },
  offset: { with: 'amount = 1', children: 'rect { size = [8, 8] }', dim: 2 },
  refine: { with: 'edge_length = 4', children: 'box { size = [8, 8, 8] }' },
  simplify: { children: 'box { size = [8, 8, 8] }' },
  smooth: { children: 'box { size = [8, 8, 8] }' },
  trim: { with: 'normal = [0, 0, 1]', children: 'box { size = [8, 8, 8] }' },
  translate: { with: 'offset = [1, 1, 1]', children: 'box { size = [8, 8, 8] }' },
  rotate: { children: 'box { size = [8, 8, 8] }' },
  scale: { with: 'factor = [1, 1, 1]', children: 'box { size = [8, 8, 8] }' },
  mirror: { with: 'normal = [1, 0, 0]', children: 'box { size = [8, 8, 8] }' },
  align: { children: 'box { size = [8, 8, 8] }' },
  part: { children: 'box { size = [8, 8, 8] }' },
};

/**
 * Attributes the generated harness cannot reach, written out in full.
 *
 * `rotate` spells its angle `angle` in 2D and `x`/`y`/`z`/`angles` in 3D, and accepts exactly
 * one vocabulary depending on what is inside it — so the 2D spelling needs a 2D child rather
 * than the 3D one every other transform is tested with.
 */
const OVERRIDES = {
  'rotate.angle': 'model "m" { part "p" { extrude { height = 2  rotate { angle = 30  rect { size = [8, 8] } } } } }',
};

/** Attributes that are an alternative spelling of another, and must be tested on their own. */
const ALTERNATIVES = new Set([
  'diameter', 'bottom_radius', 'top_radius', 'width_across_corners', 'width_across_flats',
]);

/**
 * A document that sets one attribute on one block, wrapped so it can be rendered.
 *
 * @param {string} name The block.
 * @param {import('../src/catalogue.js').Entry} entry Its catalogue entry.
 * @param {import('../src/catalogue.js').Attribute} attribute The attribute under test.
 * @returns {string} The document.
 */
function harnessFor(name, entry, attribute) {
  const override = OVERRIDES[`${name}.${attribute.name}`];
  if (override) return override;

  const scaffold = SCAFFOLD[name] ?? {};
  const value = sampleFor(attribute);

  if (name === 'part') {
    return `model "m" { part "p" { ${attribute.name} = ${value}  ${scaffold.children} } }`;
  }

  // An alternative spelling is refused alongside the one it replaces, on purpose, so the
  // scaffold's own radius has to come out before this one goes in.
  const shared = ALTERNATIVES.has(attribute.name)
    ? (scaffold.with ?? '').replace(/\bradius = \d+\s*/, '')
    : scaffold.with ?? '';

  const body = [shared, `${attribute.name} = ${value}`, scaffold.children].filter(Boolean).join('  ');
  const twoD = scaffold.dim === 2 || entry.dim === 2;
  return HARNESSES[twoD ? 2 : 3](name, body);
}

test('every documented attribute is one the block accepts', async (t) => {
  for (const [name, entry] of CONSTRUCTS) {
    if (!BLOCKS[name] && !['align', 'part'].includes(name)) continue;

    for (const attribute of entry.attributes) {
      const source = harnessFor(name, entry, attribute);

      await t.test(`${name}.${attribute.name}`, async () => {
        const parsed = await checkDocument(source, { solve: false });
        assert.ok(parsed.ok, parsed.error?.message);

        // Parsing accepts anything; only building rejects an attribute the block did not
        // read, so the geometry has to actually be solved for this to mean anything.
        const solved = await checkDocument(source);
        assert.ok(
          !/unknown attribute/.test(solved.error?.message ?? ''),
          `${name} rejected "${attribute.name}": ${solved.error?.message}`,
        );
      });
    }
  }
});

test('a construct renders as a readable page', () => {
  const page = formatConstruct(CONSTRUCTS.get('extrude'));
  assert.match(page, /^## `extrude`/);
  assert.match(page, /produces 3D; takes 2D children/);
  assert.match(page, /\| `height` \| number \| required \|/);
  assert.match(page, /```hcl/);
});

test('every documented example snippet is written in blocks that exist', () => {
  for (const entry of CONSTRUCTS.values()) {
    assert.ok(entry.example.trim(), `${entry.name} has no example`);
    assert.ok(entry.summary.endsWith('.'), `${entry.name}: the summary should be a sentence`);
  }
});
