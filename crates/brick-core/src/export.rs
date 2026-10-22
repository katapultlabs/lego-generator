//! Exports: LDraw (.ldr) with build steps, and a CSV parts list.

use std::fmt::Write;

use crate::color;
use crate::model::BrickModel;
use crate::parts;

/// LDraw is -Y up and right-handed like glTF, so grid (x, y, z) maps to LDraw (x, -y, -z)
/// (a 180° rotation about X, not a mirror). Rectangular parts have their origin at the top
/// centre with the long side along X.
pub fn to_ldraw(model: &BrickModel, name: &str) -> String {
    let stud = model.units.stud_ldu as f32;
    let h = model.units.layer_ldu as f32;
    let mut out = String::new();
    let _ = writeln!(out, "0 {name}");
    let _ = writeln!(out, "0 Name: {name}.ldr");
    let _ = writeln!(out, "0 Author: lego-generator");
    let _ = writeln!(out, "0 !LDRAW_ORG Unofficial_Model");
    let _ = writeln!(out);

    let mut bricks: Vec<_> = model.bricks.iter().collect();
    bricks.sort_by_key(|b| (b.step, b.z, b.x));
    let mut step = bricks.first().map(|b| b.step).unwrap_or(1);
    for b in bricks {
        if b.step != step {
            let _ = writeln!(out, "0 STEP");
            step = b.step;
        }
        let cx = (b.x as f32 + b.w as f32 / 2.0) * stud;
        let cz = -(b.z as f32 + b.d as f32 / 2.0) * stud;
        let top = -((b.y + 1) as f32) * h;
        // Long side along Z needs a 90° turn about Y.
        let rot = if b.d > b.w { "0 0 1 0 1 0 -1 0 0" } else { "1 0 0 0 1 0 0 0 1" };
        let _ = writeln!(out, "1 {} {} {} {} {} {}.dat", b.color, cx, top, cz, rot, b.part);
    }
    let _ = writeln!(out, "0 STEP");
    out
}

pub fn bom_csv(model: &BrickModel) -> String {
    let mut out = String::from("part,name,color_code,color_name,count\n");
    for l in &model.bom {
        let _ = writeln!(out, "{},{},{},{},{}", l.part, l.name, l.color, color::name_of(l.color), l.count);
    }
    out
}

pub fn part_name(part: &str) -> String {
    for p in parts::PARTS {
        if p.brick == part {
            return p.name(crate::model::LayerKind::Brick);
        }
        if p.plate == part {
            return p.name(crate::model::LayerKind::Plate);
        }
    }
    part.to_string()
}
