//! The rectangular parts we place, with their LDraw numbers.
//! In LDraw these parts lie with their long side along X.

use crate::model::LayerKind;

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
    Part { a: 1, b: 1, brick: "3005", plate: "3024" },
    Part { a: 1, b: 2, brick: "3004", plate: "3023" },
    Part { a: 1, b: 3, brick: "3622", plate: "3623" },
    Part { a: 1, b: 4, brick: "3010", plate: "3710" },
    Part { a: 1, b: 6, brick: "3009", plate: "3666" },
    Part { a: 1, b: 8, brick: "3008", plate: "3460" },
    Part { a: 2, b: 2, brick: "3003", plate: "3022" },
    Part { a: 2, b: 3, brick: "3002", plate: "3021" },
    Part { a: 2, b: 4, brick: "3001", plate: "3020" },
    Part { a: 2, b: 6, brick: "2456", plate: "3795" },
    Part { a: 2, b: 8, brick: "3007", plate: "3034" },
];

impl Part {
    pub fn number(&self, kind: LayerKind) -> &'static str {
        match kind {
            LayerKind::Brick => self.brick,
            LayerKind::Plate => self.plate,
        }
    }

    pub fn name(&self, kind: LayerKind) -> String {
        let k = match kind {
            LayerKind::Brick => "Brick",
            LayerKind::Plate => "Plate",
        };
        format!("{k} {} x {}", self.a, self.b)
    }
}

pub fn by_footprint(w: u32, d: u32) -> Option<&'static Part> {
    let (a, b) = (w.min(d), w.max(d));
    PARTS.iter().find(|p| p.a == a && p.b == b)
}
