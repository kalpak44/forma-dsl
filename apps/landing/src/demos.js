/**
 * The documents the demo types out.
 *
 * Each one is short enough to read while it is being written and to solve in well under a
 * second, and between them they cover the four things the language is for: parameters,
 * booleans, repetition, and components. They are asserted to render by the workspace's
 * tests, so a change to the library that breaks one fails the build rather than the page.
 */

/**
 * @typedef {object} Demo
 * @property {string} name What the tab calls it.
 * @property {string} caption One line on what the reader is watching.
 * @property {string} source The document, typed verbatim.
 */

/** @type {ReadonlyArray<Demo>} */
export const DEMOS = [
  {
    name: 'bracket',
    caption: 'Parameters and a boolean difference',
    source: `// Nesting is the operator: children of a
// difference are subtracted from the first.
param width { type = number  default = 54  min = 30  max = 90 }
param bore  { type = number  default = 7   min = 3   max = 14 }

model "bracket" {
  part "body" {
    color = "#82aaff"

    difference {
      extrude {
        height = 10
        rounded_rect {
          size = [var.width, 26]  radius = 5  center = true
        }
      }

      for x in [-1, 1] {
        translate {
          offset = [x * (var.width / 2 - 9), 0, -1]
          cylinder {
            radius = var.bore  height = 12  segments = 48
          }
        }
      }
    }
  }
}
`,
  },

  {
    name: 'flange',
    caption: 'A for loop placing the bolt circle',
    source: `param bolts { type = number  default = 8  min = 3  max = 16 }

model "flange" {
  part "plate" {
    color = "#e9a94b"

    difference {
      extrude {
        height = 6
        circle { radius = 34  segments = 72 }
      }

      translate {
        offset = [0, 0, -1]
        extrude {
          height = 8  circle { radius = 12  segments = 48 }
        }
      }

      for i in range(0, var.bolts) {
        rotate {
          z = i * 360 / var.bolts
          translate {
            offset = [26, 0, -1]
            cylinder { radius = 2.6  height = 8  segments = 24 }
          }
        }
      }
    }
  }
}
`,
  },

  {
    name: 'component',
    caption: 'A component, declared once and called twice',
    source: `// A component is a parameterised block
// you call like any builtin.
component "tray" {
  param size = [38, 28, 11]
  param wall = 2

  difference {
    extrude {
      height = size.z
      rounded_rect {
        size = [size.x, size.y]  radius = 4  center = true
      }
    }
    translate {
      offset = [0, 0, wall]
      extrude {
        height = size.z
        rounded_rect {
          size   = [size.x - wall * 2, size.y - wall * 2]
          radius = 3
          center = true
        }
      }
    }
  }
}

model "stack" {
  for i in range(0, 2) {
    part "tray" {
      color = i % 2 == 0 ? "#6ec49a" : "#82aaff"
      translate { offset = [0, 0, i * 12]  tray { } }
    }
  }
}
`,
  },

  {
    name: 'vase',
    caption: 'A profile, revolved and then hollowed',
    source: `// revolve turns a 2D profile into a solid of revolution.
model "vase" {
  part "vase" {
    color = "#4f9d8c"

    difference {
      revolve {
        segments = 72
        polygon {
          points = [
            [0, 0], [24, 0], [22, 8], [14, 30],
            [16, 58], [20, 68], [0, 68],
          ]
        }
      }
      translate {
        offset = [0, 0, 3]
        revolve {
          segments = 72
          polygon {
            points = [
              [0, 0], [19, 0], [11, 30],
              [13, 58], [17, 66], [0, 66],
            ]
          }
        }
      }
    }
  }
}
`,
  },
];
