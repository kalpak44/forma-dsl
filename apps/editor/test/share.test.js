import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeShare, encodeShare } from 'forma-dsl';

import { EXAMPLES } from '../src/examples.js';
import { linkTo, sharedPayload } from '../src/share.js';

test('a share link is recognised by its version, and nothing else is', () => {
  assert.equal(sharedPayload('#v1.abc'), 'v1.abc');
  assert.equal(sharedPayload('v1.abc'), 'v1.abc');
  assert.equal(sharedPayload('#v7.abc'), 'v7.abc', 'a newer format is still a share link, to be refused by name');
  assert.equal(sharedPayload(''), null);
  assert.equal(sharedPayload('#'), null);
  assert.equal(sharedPayload('#section'), null);
});

test('a link replaces whatever fragment the page had, and keeps the rest of the address', () => {
  assert.equal(
    linkTo('https://example.github.io/forma-dsl/editor/#v1.old', 'v1.new'),
    'https://example.github.io/forma-dsl/editor/#v1.new',
  );
  assert.equal(linkTo('http://localhost:5173/?x=1', 'v1.abc'), 'http://localhost:5173/?x=1#v1.abc');
});

test('every shipped example makes a link that opens to the same document', async () => {
  for (const [name, source] of Object.entries(EXAMPLES)) {
    const link = linkTo('https://example.github.io/forma-dsl/editor/', await encodeShare({ source }));
    const payload = sharedPayload(new URL(link).hash);
    assert.equal((await decodeShare(payload)).source, source, name);
  }
});
