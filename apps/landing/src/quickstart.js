/**
 * The snippet in the install section.
 *
 * It lives here rather than in the markup so that it is highlighted by the same classifier
 * the demo uses, and so the copy button copies exactly what is on screen.
 */

/** @type {string} The quickstart, as a reader would paste it. */
export const QUICKSTART = `npm install forma-dsl

# A model, a parameter sweep, and three files for the slicer.
import { render, toBinarySTL, EvaluationContext } from 'forma-dsl';
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
