/**
 * What `forma` does with the arguments it is given, and what it writes where.
 *
 * `run` is driven in process with collected streams rather than spawned, so these assert on
 * the exit code and on both streams rather than on a subprocess's output. One test does spawn
 * the real executable, because the shebang and the `bin` wiring are the part only a spawn can
 * prove.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { run, UsageError } from '../src/cli.js';

const EXECUTABLE = fileURLToPath(new URL('../src/bin.js', import.meta.url));

const RISER = `param height { type = number  default = 20  min = 8  max = 40 }
param label = "riser"

model "riser" {
  part "body" {
    difference {
      extrude { height = var.height  rect { size = [40, 20]  center = true } }
      cylinder { radius = 5  height = 100 }
    }
  }
}

model "plate" {
  part "a" { box { size = [10, 10, 2] } }
  part "b" { translate { offset = [20, 0, 0]  box { size = [10, 10, 2] } } }
}
`;

/** Collects what a command writes, so a test can assert on each stream separately. */
function streams() {
  const out = [];
  const err = [];
  return {
    io: {
      out: { write: (chunk) => out.push(chunk) },
      err: { write: (chunk) => err.push(chunk) },
    },
    /** Everything written to stdout, as text. */
    get stdout() { return out.filter((chunk) => typeof chunk === 'string').join(''); },
    /** Everything written to stdout, as bytes. */
    get bytes() { return out.find((chunk) => typeof chunk !== 'string'); },
    get stderr() { return err.join(''); },
  };
}

/**
 * A directory holding a document, and the paths around it.
 *
 * The command confines a document and its output to the directory it is run in, so the test
 * moves there rather than passing a path from outside it.
 */
async function fixture(source = RISER, name = 'riser.forma') {
  const dir = await mkdtemp(join(tmpdir(), 'forma-cli-'));
  process.chdir(dir);
  const file = join(dir, name);
  await writeFile(file, source);
  return { dir, file, out: join(dir, 'out.stl') };
}

// --- rendering -----------------------------------------------------------------------

test('render writes a binary STL and says what it built', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out], io.io), 0);

  const stl = await readFile(out);
  // 80-byte header, then a 4-byte triangle count the rest of the file has to agree with.
  assert.equal(stl.length, 84 + stl.readUInt32LE(80) * 50);
  assert.match(io.stderr, /triangles · model "riser", part "body"/);
  assert.equal(io.stdout, '');
});

test('render defaults the output to the document, named .stl', async () => {
  const { dir, file } = await fixture();

  assert.equal(await run(['render', file], streams().io), 0);
  await readFile(join(dir, 'riser.stl'));
});

test('a param given on the command line changes the solid', async () => {
  const { file, out } = await fixture();

  await run(['render', file, '-o', out], streams().io);
  const short = await readFile(out);
  await run(['render', file, '-o', out, '-p', 'height=39'], streams().io);
  const tall = await readFile(out);

  // Same topology, different coordinates: the same size in bytes, different in content.
  assert.equal(tall.length, short.length);
  assert.notDeepEqual(tall, short);
});

test('a param value is JSON where it parses as JSON, and a string otherwise', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out, '-p', 'height=12', '-p', 'label=M6'], io.io), 0);
  assert.match(io.stderr, /triangles/);
});

test('--out of - writes the STL to stdout and keeps the summary on stderr', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', '-'], io.io), 0);
  assert.ok(io.bytes instanceof Uint8Array);
  assert.equal(io.stdout, '');
  assert.match(io.stderr, /^stdout .*triangles/);
});

test('--quiet prints nothing at all on success', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out, '--quiet'], io.io), 0);
  assert.equal(io.stderr, '');
  assert.equal(io.stdout, '');
});

test('--segments raises the triangle count of a curved solid', async () => {
  const { file, out } = await fixture();
  const coarse = streams();
  const fine = streams();

  await run(['render', file, '-o', out, '--segments', '12'], coarse.io);
  const low = (await readFile(out)).readUInt32LE(80);
  await run(['render', file, '-o', out, '--segments', '64'], fine.io);

  assert.ok((await readFile(out)).readUInt32LE(80) > low);
});

test('a model with several parts is written as one unioned solid', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out, '-m', 'plate'], io.io), 0);
  assert.match(io.stderr, /model "plate", part "all"/);
});

test('--part picks one part out of a model', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out, '-m', 'plate', '--part', 'b'], io.io), 0);
  assert.match(io.stderr, /part "b"/);
});

test('--max-nodes refuses a document that would build more than it allows', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out, '--max-nodes', '2'], io.io), 1);
  assert.match(io.stderr, /more than 2 blocks built/);
});

// --- listing -------------------------------------------------------------------------

test('params lists what the document declares', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['params', file], io.io), 0);
  assert.match(io.stdout, /height {2}number {2}20 {2}\[8\.\.40]/);
});

test('params --json is machine readable', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['params', file, '--json'], io.io), 0);
  const [height] = JSON.parse(io.stdout);
  assert.deepEqual(
    { name: height.name, type: height.type, default: height.default, required: height.required },
    { name: 'height', type: 'number', default: 20, required: false },
  );
});

test('a document with no params says so rather than printing nothing', async () => {
  const { file } = await fixture('model "m" { box { size = 1 } }');
  const io = streams();

  assert.equal(await run(['params', file], io.io), 0);
  assert.equal(io.stdout, 'no params declared\n');
});

test('models names every model, in source order', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['models', file], io.io), 0);
  assert.equal(io.stdout, 'riser\nplate\n');
});

test('models --json is machine readable', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['models', file, '--json'], io.io), 0);
  assert.deepEqual(JSON.parse(io.stdout), ['riser', 'plate']);
});

test('a document with no models says so', async () => {
  const { file } = await fixture('param a = 1');
  const io = streams();

  assert.equal(await run(['models', file], io.io), 0);
  assert.equal(io.stdout, 'no models declared\n');
});

// --- failing ------------------------------------------------------------------------

test('a syntax error exits 1 and points at the column with a caret', async () => {
  const { file, out } = await fixture('model "m" {\n  box { size = }\n}\n', 'bad.forma');
  const io = streams();

  assert.equal(await run(['render', file, '-o', out], io.io), 1);
  assert.match(io.stderr, /bad\.forma:2:16: unexpected "}"/);

  // The caret has to land under the character the position names, not merely exist.
  const lines = io.stderr.split('\n');
  const caret = lines.findIndex((line) => line.includes('^'));
  assert.equal(lines[caret].indexOf('^'), lines[caret - 1].lastIndexOf('}'));
});

test('the position is printed once, not twice', async () => {
  const { file, out } = await fixture('model "m" {\n  box { size = }\n}\n', 'bad.forma');
  const io = streams();

  await run(['render', file, '-o', out], io.io);
  assert.doesNotMatch(io.stderr, /\(line \d+, column \d+\)/);
});

test('a mistake in the invocation exits 2, a document that does not build exits 1', async () => {
  const { file, out } = await fixture();

  assert.equal(await run(['render', file, '-o', out, '--part', 'nope'], streams().io), 2);
  assert.equal(await run(['render', file, '-o', out, '-m', 'nope'], streams().io), 1);
});

test('an unknown command names the ones that exist', async () => {
  const io = streams();

  assert.equal(await run(['explode', 'x.forma'], io.io), 2);
  assert.match(io.stderr, /unknown command "explode"/);
});

test('an unknown option exits 2 rather than being ignored', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '--nope'], io.io), 2);
});

test('a command with no file says so', async () => {
  const io = streams();

  assert.equal(await run(['render'], io.io), 2);
  assert.match(io.stderr, /render wants a file/);
});

test('a second file is a mistake rather than a thing to ignore', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, file], io.io), 2);
  assert.match(io.stderr, /takes one file, got 2/);
});

test('an unreadable document is reported as such', async () => {
  const io = streams();

  assert.equal(await run(['params', join(tmpdir(), 'forma-does-not-exist.forma')], io.io), 2);
  assert.match(io.stderr, /cannot read .*forma-does-not-exist\.forma/);
});

test('a document outside the working directory is refused', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'forma-outside-'));
  const file = join(outside, 'riser.forma');
  await writeFile(file, RISER);
  await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', '-'], io.io), 2);
  assert.match(io.stderr, /outside the working directory/);
});

test('an output outside the working directory is refused', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', join(tmpdir(), 'elsewhere.stl')], io.io), 2);
  assert.match(io.stderr, /outside the working directory/);
});

test('--param without a value is refused', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out, '-p', 'height'], io.io), 2);
  assert.match(io.stderr, /--param wants name=value/);
});

test('a non-numeric number is refused by the flag that wanted one', async () => {
  const { file, out } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', out, '--segments', 'many'], io.io), 2);
  assert.match(io.stderr, /--segments wants a number, got "many"/);
});

test('--out is refused when it would overwrite the document itself', async () => {
  const { file } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', file], io.io), 2);
  assert.match(io.stderr, /would overwrite the document itself/);
});

test('an unwritable output path is reported rather than thrown', async () => {
  const { file, dir } = await fixture();
  const io = streams();

  assert.equal(await run(['render', file, '-o', join(dir, 'no', 'such', 'out.stl')], io.io), 2);
  assert.match(io.stderr, /cannot write /);
});

test('a UsageError is what the invocation mistakes are', () => {
  assert.ok(new UsageError('x') instanceof Error);
  assert.equal(new UsageError('x').name, 'UsageError');
});

// --- the entry point -----------------------------------------------------------------

test('--help prints the usage and --version prints the version', async () => {
  const help = streams();
  const version = streams();

  assert.equal(await run(['--help'], help.io), 0);
  assert.match(help.stdout, /Usage\n {2}forma render/);

  assert.equal(await run(['--version'], version.io), 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});

test('no arguments at all prints the usage and exits 2', async () => {
  const io = streams();

  assert.equal(await run([], io.io), 2);
  assert.match(io.stdout, /Usage/);
});

test('the executable itself runs, and carries the exit code out of the process', async () => {
  const { file, out } = await fixture();
  const run = promisify(execFile);

  const ok = await run(process.execPath, [EXECUTABLE, 'render', file, '-o', out]);
  assert.match(ok.stderr, /triangles/);

  await assert.rejects(
    () => run(process.execPath, [EXECUTABLE, 'render', 'nowhere.forma']),
    (error) => error.code === 2,
  );
});

test('a document read from stdin renders, and needs an explicit --out', async () => {
  const { out } = await fixture();
  const spawn = promisify(execFile);

  const child = spawn(process.execPath, [EXECUTABLE, 'render', '-', '-o', out]);
  child.child.stdin.end('model "m" { box { size = 10 } }');
  assert.match((await child).stderr, /triangles/);

  await assert.rejects(
    async () => {
      const refused = spawn(process.execPath, [EXECUTABLE, 'render', '-']);
      refused.child.stdin.end('model "m" { box { size = 10 } }');
      await refused;
    },
    (error) => error.code === 2 && /needs an explicit --out/.test(error.stderr),
  );
});
