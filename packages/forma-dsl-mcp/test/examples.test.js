/**
 * Every example has to render, at every corner of every param's declared range.
 *
 * An example that only works at its defaults is worse than no example: it is the one a model
 * copies, and the failure surfaces in whatever it copied it into.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { EXAMPLES, EXAMPLES_BY_NAME } from '../src/examples.js';
import { checkDocument, disposeSharedContext } from '../src/document.js';

test.after(() => disposeSharedContext());

test('there are examples, and each is described', () => {
  assert.ok(EXAMPLES.length >= 5);
  for (const example of EXAMPLES) {
    assert.ok(example.summary.endsWith('.'), `${example.name}: the summary should be a sentence`);
    assert.ok(example.shows.length, `${example.name}: say what it shows`);
    assert.equal(EXAMPLES_BY_NAME.get(example.name), example);
  }
});

for (const example of EXAMPLES) {
  test(`${example.name} renders, and is not empty`, async () => {
    const report = await checkDocument(example.source);

    assert.ok(report.ok, report.error?.message);
    assert.ok(report.scene.parts.length, 'produced no parts');
    for (const part of report.scene.parts) {
      assert.ok(part.volume > 0, `part "${part.name}" solved to nothing`);
      assert.equal(part.empty, false);
    }
  });

  test(`${example.name} renders at the ends of its declared ranges`, async () => {
    const { parameters } = await checkDocument(example.source, { solve: false });

    for (const bound of ['min', 'max']) {
      const params = Object.fromEntries(
        parameters
          .filter((parameter) => parameter[bound] !== undefined)
          .map((parameter) => [parameter.name, parameter[bound]]),
      );
      if (!Object.keys(params).length) continue;

      const report = await checkDocument(example.source, { params });
      assert.ok(report.ok, `at every ${bound}: ${report.error?.message}`);
      for (const part of report.scene.parts) {
        assert.ok(part.volume > 0, `at every ${bound}, part "${part.name}" solved to nothing`);
      }
    }
  });
}
