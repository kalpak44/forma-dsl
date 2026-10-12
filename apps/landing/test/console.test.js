/**
 * Whether the terminal on the landing page is telling the truth.
 *
 * It is a transcript, not a process - so the one thing that can go wrong is it claiming an
 * output the CLI would not produce. These render the documents it shows through the real
 * library and hold the numbers and the diagnostics to what actually comes back, which is the
 * same rule the demos are held to: nothing on the site is a screenshot of something that
 * once worked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  render, Program, describeParameters, excerpt, FormaError, GeometryNode, toBinarySTL,
} from 'forma-dsl';

import { createPage } from './dom.js';
import { BROKEN, CLI_SESSION, Console, HEIGHT, RISER, TRIANGLES } from '../src/console.js';
import { EXPORT_HEIGHT, MCP_SESSION, TREE_V1, TREE_V2 } from '../src/mcp.js';

test('the riser the terminal renders still builds, with the triangles it claims', async () => {
  const result = await render(RISER, { params: { height: HEIGHT } });

  try {
    assert.equal(result.name, 'riser');
    assert.equal(result.parts.length, 1);
    assert.equal(result.parts[0].name, 'body');
    assert.equal(result.parts[0].concrete.numTri(), TRIANGLES);
  } finally {
    result.context.dispose();
  }
});

test('the summary line names the model, the part and the triangles it just claimed', () => {
  const [{ output }] = CLI_SESSION;

  assert.ok(output[0].text.includes(`${TRIANGLES} triangles`));
  assert.match(output[0].text, /model "riser", part "body"/);
});

test('the params listing matches what the document actually declares', () => {
  const [declared, ...rest] = describeParameters(RISER);
  const line = CLI_SESSION[1].output[0].text;

  assert.equal(rest.length, 0, 'the transcript shows one param, so the document must have one');
  for (const field of [declared.name, declared.type, String(declared.default)]) {
    assert.ok(line.includes(field), `the listing omits ${field}`);
  }
  assert.ok(line.includes(`[${declared.min}..${declared.max}]`));
});

test('the broken document fails where the transcript says it does', () => {
  let thrown;
  try {
    Program.parse(BROKEN);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof FormaError, 'the third beat is only honest if this still fails');

  const [message, ...lines] = CLI_SESSION[2].output;
  assert.equal(message.text, `broken.forma:${thrown.loc.line}:${thrown.loc.column}: ${thrown.message.replace(/ \(line \d+, column \d+\)$/, '')}`);

  // The caret rows are the library's own excerpt, which is what the CLI prints.
  assert.deepEqual(lines.map((line) => line.text), excerpt(BROKEN, thrown.loc).split('\n'));
});

test('every beat in either session is a command with output, in a tone that has a colour', () => {
  for (const session of [CLI_SESSION, MCP_SESSION]) {
    for (const beat of session) {
      assert.ok(beat.command.length > 0, 'a beat with no command types nothing');
      assert.ok(beat.output.length > 0, `${beat.command} shows nothing`);
      for (const { tone } of beat.output) {
        assert.ok(['out', 'note', 'bad', 'caret'].includes(tone), `unknown tone ${tone}`);
      }
    }
  }
});

test('the CLI session only ever runs forma', () => {
  for (const beat of CLI_SESSION) {
    assert.match(beat.command, /^forma /, 'a beat that is not a forma command does not belong');
  }
});

/**
 * Pulls the measured rows out of one beat's table.
 *
 * @param {number} beat Which beat of the agent session.
 * @returns {Array<{ part: string, size: string, volume: string, triangles: string }>} The rows.
 */
function rows(beat) {
  return MCP_SESSION[beat].output
    .map((line) => line.text)
    .filter((text) => text.startsWith('| ') && !text.includes('Part   |'))
    .map((text) => text.split('|').map((cell) => cell.trim()))
    .map(([, part, size, volume, triangles]) => ({ part, size, volume, triangles }));
}

/**
 * Measures a document the way the MCP server does, so the table can be compared to it.
 *
 * @param {string} source The document.
 * @param {Record<string, number>} [params] Values for its params.
 * @returns {Promise<Array<{ part: string, size: string, volume: string, triangles: string }>>}
 *   One row per part, spelled as the transcript spells them.
 */
async function measure(source, params = {}) {
  const result = await render(source, { params });
  try {
    return result.parts.map((part) => {
      const box = part.concrete.boundingBox();
      const size = box.max.map((high, axis) => Number((high - box.min[axis]).toFixed(4)));
      return {
        part: part.name,
        size: size.join(' × '),
        volume: String(Number(part.concrete.volume().toFixed(4))),
        triangles: String(part.concrete.numTri()),
      };
    });
  } finally {
    result.context.dispose();
  }
}

test('the first table is what the kernel really measures for the document it wrote', async () => {
  assert.deepEqual(rows(0), await measure(TREE_V1));
});

test('the edited table is what the kernel really measures after the edit', async () => {
  assert.deepEqual(rows(1), await measure(TREE_V2));
});

test('the edit changes the canopy and leaves the trunk alone, as the transcript claims', () => {
  const [beforeTrunk, beforeCanopy] = rows(0);
  const [afterTrunk, afterCanopy] = rows(1);

  assert.deepEqual(afterTrunk, beforeTrunk, 'the trunk was not what the second prompt asked about');
  assert.notDeepEqual(afterCanopy, beforeCanopy, 'the canopy was');
});

test('the byte counts are the documents own length', () => {
  const written = MCP_SESSION
    .flatMap((beat) => beat.output)
    .map((line) => line.text)
    .filter((text) => text.includes('`tree.forma`'));

  assert.ok(written[0].includes(`${TREE_V1.length} bytes`));
  assert.ok(written[1].includes(`${TREE_V2.length} bytes`));
});

test('the export beat reports the STL the library really produces', async () => {
  const claimed = MCP_SESSION[2].output.map((line) => line.text).join(' ');
  const result = await render(TREE_V2, { params: { height: EXPORT_HEIGHT } });

  try {
    const union = GeometryNode.union(result.parts.map((part) => part.node));
    const solid = await result.context.evaluate(union);
    const bytes = toBinarySTL(solid);

    assert.ok(claimed.includes(`${bytes.length} bytes`), `claimed ${claimed}`);
    assert.ok(claimed.includes(`${solid.numTri()} triangles`));
  } finally {
    result.context.dispose();
  }
});

test('a reader who asked for no motion gets the whole transcript at once', () => {
  const page = createPage();
  page.media('(prefers-reduced-motion: reduce)', true);
  const root = page.document.createElement('div');
  page.document.body.append(root);

  new Console(root, CLI_SESSION).start();

  assert.deepEqual(
    [...root.querySelectorAll('.tty-cmd')].map((line) => line.textContent),
    CLI_SESSION.map((beat) => beat.command),
  );
  assert.equal(
    root.querySelectorAll('.tty-line').length,
    CLI_SESSION.reduce((total, beat) => total + 1 + beat.output.length, 0),
    'every command and every line it printed',
  );
});

test('the transcript types nothing until it is scrolled to', () => {
  const page = createPage();
  page.media('(prefers-reduced-motion: reduce)', false);
  const root = page.document.createElement('div');
  page.document.body.append(root);

  const terminal = new Console(root, CLI_SESSION);
  terminal.start();
  assert.equal(root.querySelectorAll('.tty-line').length, 0);

  page.intersect(root);
  assert.equal(root.querySelectorAll('.tty-cmd').length, 1, 'the first command, still empty');

  // The loop never ends on its own, so a test that starts one has to end it.
  terminal.stop();
});

test('each terminal carries its own prompt, which is the stylesheet\'s and not the text\'s', () => {
  const page = createPage();
  page.media('(prefers-reduced-motion: reduce)', true);

  for (const [session, prompt] of [[CLI_SESSION, 'shell'], [MCP_SESSION, 'chat']]) {
    const root = page.document.createElement('div');
    page.document.body.append(root);
    new Console(root, session, prompt).start();

    const commands = [...root.querySelectorAll('.tty-cmd')];
    assert.equal(commands.length, session.length);
    for (const line of commands) {
      assert.ok(line.classList.contains(`tty-${prompt}`));
      assert.doesNotMatch(line.textContent, /^[$›]/, 'the marker is painted, never typed');
    }
  }
});
