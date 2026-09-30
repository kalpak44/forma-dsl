/**
 * The snippet in the MCP section.
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
