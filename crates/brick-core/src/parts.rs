//! The parts we place, with their LDraw numbers.
//! In LDraw the rectangular parts lie with their long side along X.

use crate::model::{LayerKind, Shape};

#[derive(Debug, Clone, Copy)]
pub struct Part {
    /// Short side, in studs.
    pub a: u32,
    /// Long side, in studs.
    pub b: u32,
    pub brick: &'static str,
    pub plate: &'static str,
}

pub const PARTS: &[Part] = &[
    Part {
        a: 1,
        b: 1,
        brick: "3005",
        plate: "3024",
    },
    Part {
        a: 1,
        b: 2,
        brick: "3004",
        plate: "3023",
    },
    Part {
        a: 1,
        b: 3,
        brick: "3622",
        plate: "3623",
    },
    Part {
        a: 1,
        b: 4,
        brick: "3010",
        plate: "3710",
    },
    Part {
        a: 1,
        b: 6,
        brick: "3009",
        plate: "3666",
    },
    Part {
        a: 1,
        b: 8,
        brick: "3008",
        plate: "3460",
    },
    Part {
        a: 2,
        b: 2,
        brick: "3003",
        plate: "3022",
    },
    Part {
        a: 2,
        b: 3,
        brick: "3002",
        plate: "3021",
    },
    Part {
        a: 2,
        b: 4,
        brick: "3001",
        plate: "3020",
    },
    Part {
        a: 2,
        b: 6,
        brick: "2456",
        plate: "3795",
    },
    Part {
        a: 2,
        b: 8,
        brick: "3007",
        plate: "3034",
    },
];

/// Slope 30 1 x 1 x 2/3 ("cheese slope"): two plates tall, no studs.
pub const CHEESE_SLOPE: &str = "54200";
pub const CHEESE_SLOPE_NAME: &str = "Slope 30 1 x 1 x 2/3";
/// Height of the cheese slope in plate layers.
pub const CHEESE_SLOPE_LAYERS: usize = 2;

pub fn by_footprint(w: u32, d: u32) -> Option<&'static Part> {
    let (a, b) = (w.min(d), w.max(d));
    PARTS.iter().find(|p| p.a == a && p.b == b)
}

/// Part number and display name for a placed part of `h` layers in a model built with `kind`.
pub fn identify(
    w: u32,
    d: u32,
    h: u32,
    kind: LayerKind,
    shape: Shape,
) -> Option<(&'static str, String)> {
    if shape == Shape::Slope {
        return Some((CHEESE_SLOPE, CHEESE_SLOPE_NAME.to_string()));
    }
    let part = by_footprint(w, d)?;
    let is_brick = match kind {
        LayerKind::Brick => true,
        LayerKind::Plate => false,
        LayerKind::Mixed => h == 3,
    };
    let (number, label) = if is_brick {
        (part.brick, "Brick")
    } else {
        (part.plate, "Plate")
    };
    Some((number, format!("{label} {} x {}", part.a, part.b)))
}

/// Display name for a part number.
pub fn name_of(number: &str) -> String {
    if number == CHEESE_SLOPE {
        return CHEESE_SLOPE_NAME.to_string();
    }
    for p in PARTS {
        if p.brick == number {
            return format!("Brick {} x {}", p.a, p.b);
        }
        if p.plate == number {
            return format!("Plate {} x {}", p.a, p.b);
        }
    }
    number.to_string()
}
