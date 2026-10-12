/**
 * The snippet in the MCP section, and the session the terminal beside it plays.
 *
 * It lives here rather than in the markup for the same reason the quickstart does: it is
 * highlighted by the classifier the demo types through, so the code blocks on the page cannot
 * drift apart in colour, and the copy button copies exactly what is on screen.
 */

/**
 * @type {string} Installing the server, and the ask that follows. What the ask produces is
 * not repeated here: the terminal beside this block plays it, with numbers a test checks.
 */
export const MCP_SETUP = `# Claude Code
claude mcp add forma -- npx -y forma-dsl-mcp

# Codex
codex mcp add forma -- npx -y forma-dsl-mcp

# Then, in the folder you keep models in:
#
#   "build me a forma file with a tree in it"
`;

/**
 * The document the agent writes in the first beat.
 *
 * Exported because the test renders it: the sizes, volumes and triangle counts the terminal
 * prints are checked against what the kernel actually produces, so the page cannot claim a
 * measurement the language no longer gives back.
 */
export const TREE_V1 = `model "tree" {
  part "trunk" {
    color = "#6b4f3a"
    cylinder { radius = 4  height = 30  segments = 32 }
  }
  part "canopy" {
    color = "#4e8b52"
    translate { offset = [0, 0, 36]  sphere { radius = 14  segments = 32 } }
  }
}
`;

/** The same document after the second beat's edit: a tapered canopy and a height parameter. */
export const TREE_V2 = `param height { type = number  default = 30  min = 20  max = 60 }

model "tree" {
  part "trunk" {
    color = "#6b4f3a"
    cylinder { radius = 4  height = var.height  segments = 32 }
  }
  part "canopy" {
    color = "#4e8b52"
    translate {
      offset = [0, 0, var.height + 6]
      cone { radius = 14  top_radius = 3  height = 26  segments = 32 }
    }
  }
}
`;

/** The height the third beat exports at, and that the test exports at. */
export const EXPORT_HEIGHT = 45;

/**
 * The session the terminal in the MCP section plays.
 *
 * A transcript of the shape a real exchange takes, not a recording of one: a prompt is typed
 * at an agent, the agent calls the tools, and what comes back is the measured report the
 * server really answers with - a row per part with the numbers that decide whether the thing
 * is the size it was asked for and is actually a solid.
 *
 * It shows the loop that matters, which is editing rather than generating: the second prompt
 * changes a model that already exists, and the measurements move with it. `forma_read` builds
 * the file before the edit so the agent is working from what is there rather than from what
 * it remembers writing.
 *
 * Every number here is measured. `test/console.test.js` renders both documents through the
 * library and holds the table to what the kernel actually produces, so the page cannot drift
 * into claiming a volume or a triangle count that no longer comes out.
 *
 * @type {Array<{ command: string, output: Array<{ text: string, tone: string }> }>}
 */
export const MCP_SESSION = [
  {
    command: 'build me a forma file with a tree in it',
    output: [
      { text: 'forma_guide   the language, in one page', tone: 'note' },
      { text: 'forma_blocks  cylinder, sphere, translate', tone: 'note' },
      { text: 'forma_write   tree.forma', tone: 'note' },
      { text: '', tone: 'out' },
      { text: `Wrote \`tree.forma\` under \`~/models\` - ${TREE_V1.length} bytes.`, tone: 'out' },
      { text: '', tone: 'out' },
      { text: '| Part   | Size (X × Y × Z) | Volume     | Triangles | Genus |', tone: 'out' },
      { text: '| trunk  | 8 × 8 × 30       | 1498.2937  |       124 |     0 |', tone: 'out' },
      { text: '| canopy | 28 × 28 × 28     | 11237.284  |       512 |     0 |', tone: 'out' },
      { text: '', tone: 'out' },
      { text: 'Overall bounding box: 28 × 28 × 50', tone: 'note' },
    ],
  },
  {
    command: 'taper the canopy to a point, and make the height a parameter',
    output: [
      { text: 'forma_read    tree.forma, built and measured', tone: 'note' },
      { text: 'forma_blocks  cone, param', tone: 'note' },
      { text: 'forma_write   tree.forma, replacing what was there', tone: 'note' },
      { text: '', tone: 'out' },
      { text: `Wrote \`tree.forma\` under \`~/models\` - ${TREE_V2.length} bytes, replacing what was there.`, tone: 'out' },
      { text: '', tone: 'out' },
      { text: '| Part   | Size (X × Y × Z) | Volume     | Triangles | Genus |', tone: 'out' },
      { text: '| trunk  | 8 × 8 × 30       | 1498.2937  |       124 |     0 |', tone: 'out' },
      { text: '| canopy | 28 × 28 × 26     | 6681.9736  |       124 |     0 |', tone: 'out' },
      { text: '', tone: 'out' },
      { text: 'Overall bounding box: 28 × 28 × 62   ·   param height = 30 [20..60]', tone: 'note' },
    ],
  },
  {
    command: `export it at height ${EXPORT_HEIGHT}`,
    output: [
      { text: 'forma_export_stl  tree.stl', tone: 'note' },
      { text: '', tone: 'out' },
      { text: 'Wrote `tree.stl` under `~/models` - 12484 bytes, 248 triangles,', tone: 'out' },
      { text: 'from model `tree`, part `all`.', tone: 'out' },
    ],
  },
];
