/**
 * The snippet in the MCP section, and the session the terminal beside it plays.
 *
 * It lives here rather than in the markup for the same reason the quickstart does: it is
 * highlighted by the classifier the demo types through, so the code blocks on the page cannot
 * drift apart in colour, and the copy button copies exactly what is on screen.
 */

/** @type {string} Installing the server, and the ask that follows. */
export const MCP_SETUP = `# Claude Code
claude mcp add forma -- npx -y forma-dsl-mcp

# Codex
codex mcp add forma -- npx -y forma-dsl-mcp

# Then, in the folder you keep models in:
#
#   "build me a forma file with a tree in it"
#
# It reads the guide and the blocks it needs, writes the document,
# and forma_write builds it before it reaches the disk:
#
#   Wrote \`tree.forma\` - 537 bytes.
#
#   | Part     | Size (X x Y x Z) | Volume    | Triangles | Genus |
#   | trunk    | 8 x 8 x 30       | 1004.682  |       108 |     0 |
#   | canopy   | 28 x 28 x 30     | 5193.4555 |       358 |     0 |
#
#   Overall bounding box: 28 x 28 x 51
`;

/**
 * The session the terminal in the MCP section plays.
 *
 * A transcript of the shape a tool call takes, not a recording of one: the prompt is typed
 * at an agent, the agent calls `forma_write`, and what comes back is the measured report the
 * server really answers with - the file it wrote, and a row per part with the numbers that
 * decide whether the thing is the size it was asked for and is actually a solid.
 *
 * The document is refused rather than written when it does not render, which is the beat
 * worth showing last: a model that guessed an attribute is told every one that exists.
 *
 * @type {Array<{ command: string, output: Array<{ text: string, tone: string }> }>}
 */
export const MCP_SESSION = [
  {
    command: 'build me a forma file with a tree in it',
    output: [
      { text: 'forma_guide → the language, in one page', tone: 'note' },
      { text: 'forma_blocks → cylinder, sphere, union, translate', tone: 'note' },
      { text: 'forma_write  → tree.forma', tone: 'note' },
      { text: '', tone: 'out' },
      { text: 'Wrote `tree.forma` under `~/models` - 537 bytes.', tone: 'out' },
      { text: '', tone: 'out' },
      { text: '| Part   | Size (X × Y × Z) | Volume    | Triangles | Genus |', tone: 'out' },
      { text: '| trunk  | 8 × 8 × 30       | 1004.682  |       108 |     0 |', tone: 'out' },
      { text: '| canopy | 28 × 28 × 30     | 5193.4555 |       358 |     0 |', tone: 'out' },
      { text: '', tone: 'out' },
      { text: 'Overall bounding box: 28 × 28 × 51', tone: 'note' },
    ],
  },
  {
    command: 'make the canopy a hexagonal prism instead',
    output: [
      { text: 'forma_write  → refused', tone: 'note' },
      { text: '', tone: 'out' },
      { text: 'cylinder: unknown attribute "sides" - cylinder reads', tone: 'bad' },
      { text: '"center", "height", "radius", "segments"', tone: 'bad' },
      { text: '', tone: 'out' },
      { text: '**Nothing was written.** Fix it and call again.', tone: 'note' },
    ],
  },
];
