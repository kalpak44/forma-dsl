# Examples

Complete `.forma` documents, each one solved before it was committed. They are meant to be
read, rendered, and then taken apart by moving a parameter.

| File | What it is | Parameters |
| --- | --- | --- |
| [`red-car.forma`](red-car.forma) | A toy car: a body with wheel arches cut into it, a cabin split around a band of glass, lights, and four wheels placed from a list | `body_color` `wheel_color` `glass_color` `length` `width` `wheel_radius` |
| [`christmas-tree.forma`](christmas-tree.forma) | A tree: a pot, a trunk, a stack of tiers, baubles on a golden-angle spiral, and a six-pointed star | `height` `tiers` `baubles` `foliage_color` `trunk_color` `pot_color` `bauble_color` `star_color` |

## Rendering one

```bash
npx forma-dsl-cli render examples/red-car.forma -o car.stl
npx forma-dsl-cli params examples/red-car.forma          # what it takes
```

From a clone, with the workspaces installed:

```bash
node packages/forma-dsl-cli/src/bin.js render examples/red-car.forma -o car.stl
```

Or paste either document into [the editor](https://kalpak44.github.io/forma-dsl/editor/),
where every parameter becomes a control.

## red-car.forma

The default is red, 120 mm long and 51 mm over the roof.

```bash
npx forma-dsl-cli render examples/red-car.forma -p body_color='#1d6fb8' -o blue-car.stl
npx forma-dsl-cli render examples/red-car.forma -p length=170 -p width=70 -o limo.stl
```

Worth reading for: a list of positions driving a `for` that both cuts the arches out of the
body and places the wheels, so the two can never disagree; a component called three times at
different sizes to make the cabin's sill, glass and roof; one `part` per coloured piece.

## christmas-tree.forma

`height` is honest: the tip of the star lands exactly on it, because the tier spacing is
derived backwards from the top rather than guessed.

```bash
npx forma-dsl-cli render examples/christmas-tree.forma -p tiers=7 -p baubles=28 -o tree.stl
npx forma-dsl-cli render examples/christmas-tree.forma -p baubles=0 -o bare-tree.stl
```

Worth reading for: `max`/`min` clamping a param whose `min`/`max` are only advisory; a
`for` that names its own parts (`part "bauble_${i}"`); a conditional colour; two triangles
union in 2D and extruded once to make the star.
