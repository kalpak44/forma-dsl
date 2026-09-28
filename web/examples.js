export const EXAMPLES = {
  'Hex key holder': `// A holder with one hexagonal slot per key size.
param height { type = number  default = 20  min = 8  max = 40  step = 1 }
param spacing { type = number  default = 8   min = 5  max = 16 }
param wall    { type = number  default = 2.5 min = 1  max = 6  step = 0.5 }

local sizes = [1.5, 2, 2.5, 3, 4, 5, 6]

model "hex_key_holder" {
  part "body" {
    color = "#6f7d8c"

    difference {
      align {
        x = "center"  y = "center"
        extrude {
          height = var.height
          rounded_rect {
            size   = [len(sizes) * var.spacing + var.wall * 2, var.spacing + var.wall * 2]
            radius = var.spacing / 2 + var.wall
            center = true
          }
        }
      }

      for i, size in sizes {
        translate {
          offset = [(i - (len(sizes) - 1) / 2) * var.spacing, 0, var.wall]
          extrude {
            height = var.height
            regular_polygon {
              sides               = 6
              width_across_flats  = size + 0.3
            }
          }
        }
      }
    }
  }
}
`,

  'Parametric flange': `param bolts    { type = number  default = 6  min = 3  max = 16 step = 1 }
param plate_r  { type = number  default = 40 min = 20 max = 80 }
param bore_r   { type = number  default = 12 min = 4  max = 30 }
param thickness = 8

model "flange" {
  part "flange" {
    color = "#c8842f"

    difference {
      extrude {
        height = thickness
        circle { radius = var.plate_r  segments = 96 }
      }

      // Central bore, cut right through.
      translate {
        offset = [0, 0, -1]
        extrude {
          height = thickness + 2
          circle { radius = var.bore_r  segments = 64 }
        }
      }

      for i in range(0, var.bolts) {
        rotate {
          z = i * 360 / var.bolts
          translate {
            offset = [var.plate_r - 9, 0, -1]
            cylinder { radius = 3  height = thickness + 2  segments = 32 }
          }
        }
      }
    }
  }
}
`,

  'Reusable components': `// A component is a named, parameterised block you can call like any builtin.
param rows { type = number default = 3 min = 1 max = 8 step = 1 }

component "rounded_box" {
  param size   = [20, 20, 10]
  param radius = 3

  // A box with rounded vertical edges: round the profile, then extrude it.
  extrude {
    height = size.z
    rounded_rect { size = [size.x, size.y]  radius = radius  center = true }
  }
}

component "tray" {
  param size = [40, 30, 12]
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
        offset = [0, 0, i * 13]
        tray { size = [40, 30, 12]  wall = 2 }
      }
    }
  }
}
`,

  'Lathe and booleans': `// revolve turns a 2D profile into a solid of revolution.
param segments { type = number default = 96 min = 12 max = 160 step = 4 }

model "vase" {
  part "vase" {
    color = "#4f9d8c"

    difference {
      revolve {
        segments = var.segments
        polygon {
          points = [
            [0, 0], [26, 0], [24, 6], [16, 26],
            [14, 48], [18, 66], [22, 74], [0, 74],
          ]
        }
      }

      translate {
        offset = [0, 0, 3]
        revolve {
          segments = var.segments
          polygon {
            points = [
              [0, 0], [21, 0], [13, 26],
              [11, 48], [15, 66], [19, 72], [0, 72],
            ]
          }
        }
      }
    }
  }

  part "base" {
    color = "#2f3b46"
    translate {
      offset = [0, 0, -3]
      cylinder { radius = 30  height = 3  segments = var.segments }
    }
  }
}
`,
};
