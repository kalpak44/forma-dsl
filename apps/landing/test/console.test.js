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

import { render, Program, describeParameters, excerpt, FormaError } from 'forma-dsl';

import { createPage } from './dom.js';
import { BROKEN, CLI_SESSION, Console, HEIGHT, RISER, TRIANGLES } from '../src/console.js';
import { MCP_SESSION } from '../src/mcp.js';

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

test('the refusal the agent session shows is the one the evaluator really raises', async () => {
  const claimed = MCP_SESSION[1].output
    .filter((line) => line.tone === 'bad')
    .map((line) => line.text)
    .join(' ');

  await assert.rejects(
    () => render('model "m" { cylinder { radius = 5  height = 10  sides = 6 } }'),
    (error) => {
      const real = error.message.replace(/ \(line \d+, column \d+\)$/, '');
      assert.equal(claimed, real, 'the page quotes a message the language no longer raises');
      return true;
    },
  );
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
