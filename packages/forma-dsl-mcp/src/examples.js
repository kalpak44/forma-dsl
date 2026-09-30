/**
 * Complete documents that render, each showing one way of building a real part.
 *
 * Examples are the highest-value thing this server carries: a model that has read one
 * working document writes better forma than one that has read every attribute table. Each is
 * rendered by `test/examples.test.js`, so an example that stops working fails the build
 * rather than teaching a mistake.
 */

/**
 * @typedef {object} Example
 * @property {string} name How it is asked for.
 * @property {string} summary What it demonstrates.
 * @property {string[]} shows The techniques it is worth reading it for.
 * @property {string} source The document.
 */

/** @type {Example[]} */
export const EXAMPLES = [
  {
    name: 'minimal',
    summary: 'The smallest document that renders.',
    shows: ['model', 'part', 'a 3D shape'],
    source: `model "block" {
  part "body" {
    color = "#6f7d8c"
    box { size = [40, 20, 10] }
  }
}
`,
  },

  {
    name: 'parametric-plate',
    summary: 'A bolted plate: params, a rounded profile extruded, and a radial array of holes.',
    shows: ['param with bounds', 'local', 'extrude a 2D profile', 'difference', 'for over range', 'rotate + translate'],
    source: `// A plate with a central bore and a bolt circle.
param plate_diameter { type = number  default = 80  min = 40  max = 160  step = 1 }
param bore_diameter  { type = number  default = 24  min = 6   max = 60 }
param thickness      { type = number  default = 8   min = 3   max = 20  step = 0.5 }
param bolts          { type = number  default = 6   min = 3   max = 16  step = 1 }
param bolt_diameter  { type = number  default = 6   min = 3   max = 12 }

local plate_r  = var.plate_diameter / 2
local circle_r = plate_r - var.bolt_diameter - 3

model "flange" {
  part "plate" {
    color = "#c8842f"

    difference {
      extrude {
        height = var.thickness
        circle { radius = plate_r  segments = 96 }
      }

      // The bore, overshooting both faces so no zero-thickness skin is left behind.
      translate {
        offset = [0, 0, -1]
        cylinder { radius = var.bore_diameter / 2  height = var.thickness + 2  segments = 64 }
      }

      for i in range(0, var.bolts) {
        rotate {
          z = i * 360 / var.bolts
          translate {
            offset = [circle_r, 0, -1]
            cylinder { radius = var.bolt_diameter / 2  height = var.thickness + 2  segments = 32 }
          }
        }
      }
    }
  }
}
`,
  },

  {
    name: 'components',
    summary: 'A stacking tray: a component for the shell, another for the cut, and a loop of parts.',
    shows: ['component with params', 'naming the negative of a feature', 'part in a loop', 'conditional colour'],
    source: `param rows { type = number  default = 3  min = 1  max = 8  step = 1 }
param wall { type = number  default = 2  min = 1  max = 5  step = 0.5 }

local tray_size = [60, 40, 14]

component "rounded_box" {
  param size   = [20, 20, 10]
  param radius = 3

  extrude {
    height = size.z
    rounded_rect { size = [size.x, size.y]  radius = radius  center = true }
  }
}

component "tray" {
  param size = [60, 40, 14]
  param wall = 2

  difference {
    rounded_box { size = size  radius = 4 }
    translate {
      offset = [0, 0, wall]
      rounded_box {
        size   = [size.x - wall * 2, size.y - wall * 2, size.z]
        radius = 3
      }
    }
  }
}

model "stacked_trays" {
  for i in range(0, var.rows) {
    part "tray_\${i}" {
      color = i % 2 == 0 ? "#3f7fbf" : "#bf6b3f"
      translate {
        offset = [0, 0, i * (tray_size.z + 1)]
        tray { size = tray_size  wall = var.wall }
      }
    }
  }
}
`,
  },

  {
    name: 'revolved-profile',
    summary: 'A vase turned from a profile — the shortest route from a drawing to a solid.',
    shows: ['polygon from a table of points', 'revolve', 'a second profile derived from the first', 'segments'],
    source: `param wall   { type = number  default = 2.4  min = 1.2  max = 5    step = 0.2 }
param base   { type = number  default = 3.5  min = 2    max = 8    step = 0.5 }
param facets { type = number  default = 96   min = 12   max = 192  step = 12 }

// The outside, drawn from the axis at the base upwards. X is the radius and Y the height:
// revolve spins the profile about the Y axis and maps its Y onto the result's Z, so a
// profile drawn upwards from [0, 0] comes out standing on the XY plane.
local outside = [
  [0, 0], [34, 0], [36, 12], [30, 46],
  [20, 78], [17, 100], [21, 118], [24, 124], [0, 124],
]

// The cavity: the same profile pulled in by the wall thickness, lifted by the base, and run
// out past the top so the mouth is open rather than capped. Both ends touch X = 0, which is
// what keeps a pillar from being left down the middle when it is revolved.
local inside = [
  [0, var.base], [34 - var.wall, var.base], [36 - var.wall, 12], [30 - var.wall, 46],
  [20 - var.wall, 78], [17 - var.wall, 100], [21 - var.wall, 118], [24 - var.wall, 130],
  [0, 130],
]

model "vase" {
  part "body" {
    color = "#8fd3e8"

    difference {
      revolve { segments = var.facets  polygon { points = outside } }
      revolve { segments = var.facets  polygon { points = inside } }
    }
  }
}
`,
  },

  {
    name: 'assembly',
    summary: 'Two coloured parts placed by measurement rather than arithmetic.',
    shows: ['several parts', 'align', 'opacity', 'a param that explodes the view'],
    source: `param lift { type = number  default = 0  min = 0  max = 60  step = 1
             description = "Raises the cap so the assembly can be inspected" }

component "case_shell" {
  difference {
    extrude {
      height = 30
      rounded_rect { size = [70, 45]  radius = 6  center = true }
    }
    translate {
      offset = [0, 0, 2]
      extrude {
        height = 30
        rounded_rect { size = [64, 39]  radius = 4  center = true }
      }
    }
  }
}

component "cap" {
  extrude {
    height = 4
    rounded_rect { size = [70, 45]  radius = 6  center = true }
  }
}

model "enclosure" {
  part "case" {
    color   = "#8fa8bd"
    opacity = 0.4
    align { z = 0  case_shell { } }
  }

  part "cap" {
    color = "#e2593c"
    align { z = 30 + var.lift  cap { } }
  }
}
`,
  },
];

/** Every example, by name. */
export const EXAMPLES_BY_NAME = new Map(EXAMPLES.map((example) => [example.name, example]));
