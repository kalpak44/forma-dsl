/**
 * The terminal in the CLI section, and the session it plays.
 *
 * The script below is not a dramatization. Every line of output is what `forma` actually
 * writes for the command above it - the summary's wording and its separators, the listing's
 * columns, and the `file:line:column:` prefix with the caret under the column. A test renders
 * the same document through the library and holds the triangle count in the first beat to
 * what the kernel really produces, so the page cannot quietly drift into claiming a number
 * the CLI would not print.
 *
 * The animation is typing and nothing more: there is no process behind it, because the one
 * thing a terminal on a landing page must not do is pretend to have run something. What it
 * shows is a transcript, and it is honest about being one.
 */

/** Milliseconds per character while a command is being typed. */
const TYPE_MS = 32;

/** How long a command sits finished before its output appears. */
const RUN_MS = 420;

/** How long the last line of a beat is left alone before the next command starts. */
const DWELL_MS = 1500;

/** How long the whole transcript rests, complete, before it plays again. */
const LOOP_MS = 5200;

/**
 * The document the first two beats are run against.
 *
 * The same riser the README and the hero use. It is here rather than only in the transcript
 * because the test renders it: the triangle count the terminal claims is checked against what
 * the kernel actually produces at `height = 32`.
 */
export const RISER = `param height { type = number  default = 20  min = 8  max = 40 }

model "riser" {
  part "body" {
    color = "#6f7d8c"
    difference {
      extrude {
        height = var.height
        rounded_rect { size = [40, 20]  radius = 4  center = true }
      }
      translate { offset = [0, 0, 3]  cylinder { radius = 5  height = var.height } }
    }
  }
}
`;

/** The height the first beat passes, and that the test renders at. */
export const HEIGHT = 32;

/** What the first beat claims the kernel produces, which the test holds it to. */
export const TRIANGLES = 252;

/**
 * The document the third beat fails on.
 *
 * Deliberately three lines with no trailing newline: the excerpt shows two lines either side
 * of the error, so a fourth would be an empty row on the page that says nothing.
 */
export const BROKEN = 'model "m" {\n  box { size = }\n}';

/**
 * The CLI section's session, as a list of beats.
 *
 * Each beat is one command and the lines it writes. `tone` decides the colour and nothing
 * else: `out` is stdout, `note` is the summary on stderr, `bad` is a diagnostic, and `caret`
 * is the line that points under a column - kept apart so it can be dimmed without dimming
 * the message above it.
 *
 * @type {Array<{ command: string, output: Array<{ text: string, tone: string }> }>}
 */
export const CLI_SESSION = [
  {
    command: `forma render riser.forma -p height=${HEIGHT} -o riser.stl`,
    output: [
      {
        text: `riser.stl - ${TRIANGLES} triangles · model "riser", part "body" · 6 nodes, 6 solved, 0 cached · 11 ms`,
        tone: 'note',
      },
    ],
  },
  {
    command: 'forma params riser.forma',
    output: [{ text: 'height  number  20  [8..40]', tone: 'out' }],
  },
  {
    command: 'forma render broken.forma -o part.stl',
    output: [
      { text: 'broken.forma:2:16: unexpected "}"', tone: 'bad' },
      { text: '1 | model "m" {', tone: 'caret' },
      { text: '2 |   box { size = }', tone: 'caret' },
      { text: '  |                ^', tone: 'caret' },
      { text: '3 | }', tone: 'caret' },
    ],
  },
];

/**
 * @param {number} ms How long to wait.
 * @returns {Promise<void>} A promise that settles then.
 */
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The terminal, for the life of the page.
 *
 * Like the demo above it, every phase checks the run it belongs to against the current one,
 * so a replay started while a beat is mid-type abandons it rather than interleaving with it.
 */
export class Console {
  /** @type {number} Bumped whenever something supersedes what is running. */
  #run = 0;

  /**
   * @param {HTMLElement} root Where the transcript is written.
   * @param {Array<{ command: string, output: Array<{ text: string, tone: string }> }>} session
   *   The beats to play.
   * @param {string} [prompt] Which prompt the command lines carry - `shell` for `$`, `chat`
   *   for the one an agent is asked at. The marker is the stylesheet's, not the transcript's.
   */
  constructor(root, session, prompt = 'shell') {
    this.root = root;
    this.session = session;
    this.prompt = prompt;
  }

  /**
   * Plays the session once it is scrolled to, and then on a loop.
   *
   * Deferred rather than started on load for the same reason the demo is: a terminal typing
   * to itself above the fold is motion competing with the headline.
   *
   * @returns {void}
   */
  start() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.#writeWhole();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        this.#loop();
      }
    }, { threshold: 0.3 });
    observer.observe(this.root);
  }

  /**
   * Abandons whatever is playing.
   *
   * The loop is endless by design, so something has to be able to end it: without this a
   * test that starts one holds the process open, and a page that replaced the terminal would
   * leave a timer typing into a detached node.
   *
   * @returns {void}
   */
  stop() {
    this.#run++;
  }

  /**
   * Writes the finished transcript with no animation at all.
   *
   * What a reader who asked for no motion gets, and also what the page falls back to if the
   * observer never fires - a terminal that stays empty would read as a broken widget.
   *
   * @returns {void}
   */
  #writeWhole() {
    this.root.textContent = '';
    for (const beat of this.session) {
      this.#line('cmd', beat.command);
      for (const { text, tone } of beat.output) this.#line(tone, text);
    }
  }

  /**
   * Appends one line.
   *
   * @param {string} tone Which kind of line it is, which decides its colour.
   * @param {string} text What it says. A command is prefixed with a prompt by the stylesheet.
   * @returns {HTMLElement} The line, so a caller still typing into it can keep hold of it.
   */
  #line(tone, text) {
    const line = document.createElement('div');
    line.className = tone === 'cmd'
      ? `tty-line tty-cmd tty-${this.prompt}`
      : `tty-line tty-${tone}`;
    line.textContent = text;
    this.root.append(line);
    return line;
  }

  /**
   * Types one command, waits, and writes what it printed.
   *
   * @param {{ command: string, output: Array<{ text: string, tone: string }> }} beat The beat.
   * @param {number} run Which run this belongs to.
   * @returns {Promise<boolean>} False once the run has been superseded, which is the caller's
   *   signal to stop rather than to start the next beat.
   */
  async #beat(beat, run) {
    const line = this.#line('cmd', '');
    line.classList.add('typing');

    // A character at a time, which is the whole effect. Nothing here is concurrent work
    // waiting to be overlapped - each await is the pause between two keystrokes.
    for (const character of beat.command) {
      if (run !== this.#run) return false;
      line.textContent += character;
      await wait(TYPE_MS);
    }
    line.classList.remove('typing');

    await wait(RUN_MS);
    if (run !== this.#run) return false;
    for (const { text, tone } of beat.output) this.#line(tone, text);

    await wait(DWELL_MS);
    return run === this.#run;
  }

  /**
   * Plays the transcript, forever.
   *
   * @returns {Promise<void>} Never settles, short of the run being superseded.
   */
  async #loop() {
    const run = ++this.#run;

    while (run === this.#run) {
      this.root.textContent = '';

      for (const beat of this.session) {
        if (!await this.#beat(beat, run)) return;
      }

      await wait(LOOP_MS);
    }
  }
}
