/**
 * The two snippets in the install section.
 *
 * Split in two because they are not the same kind of thing. One is a line you paste into a
 * shell; the other is a JavaScript file. Running them together as one block made the install
 * read as the first line of the program, and gave the `#` comment above it a meaning it does
 * not have in JavaScript.
 *
 * They live here rather than in the markup so that both are highlighted by the same
 * classifier the demo types through, and so each copy button copies exactly what is on
 * screen rather than a second copy of it kept somewhere else.
 */

/** @type {string} The one command, on its own. */
export const QUICKSTART_INSTALL = 'npm install forma-dsl';

/** @type {string} A model, a parameter sweep, and three files for the slicer. */
export const QUICKSTART_CODE = `import { render, toBinarySTL, EvaluationContext } from 'forma-dsl';
import { writeFile } from 'node:fs/promises';

const source = \`
  param height { type = number  default = 20  min = 8  max = 40 }
  model "riser" {
    extrude {
      height = var.height
      rounded_rect { size = [40, 20]  radius = 4  center = true }
    }
  }
\`;

// One context, reused: the digest cache makes the second render cheap.
const context = await EvaluationContext.create();

for (const height of [10, 20, 30]) {
  const result = await render(source, { params: { height }, context });
  const stl = toBinarySTL(result.parts[0].concrete);
  await writeFile(\`part-\${height}.stl\`, stl);
  context.collect(result.parts.map((part) => part.node));
}

context.dispose();
`;
