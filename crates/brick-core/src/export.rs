//! Exports: LDraw (.ldr) with build steps, and a CSV parts list.

use std::fmt::Write;

use crate::color;
use crate::model::{BrickModel, Facing, Shape};

/// Rotation matrix (row-major, as LDraw writes it) about the Y axis.
const ROT_0: &str = "1 0 0 0 1 0 0 0 1";
const ROT_90: &str = "0 0 1 0 1 0 -1 0 0";
const ROT_180: &str = "-1 0 0 0 1 0 0 0 -1";
const ROT_270: &str = "0 0 -1 0 1 0 1 0 0";

/// Rotation that makes a slope part descend toward `facing` (in grid space).
/// Grid z maps to LDraw -z (see `to_ldraw`).
fn slope_rotation(facing: Facing) -> &'static str {
    // 54200 descends toward LDraw -Z in its own frame, i.e. grid +z.
    match facing {
        Facing::PosZ => ROT_0,
        Facing::NegZ => ROT_180,
        Facing::PosX => ROT_270,
        Facing::NegX => ROT_90,
    }
}

/// LDraw file for a part number. Some numbers are one-line "~Moved to" aliases in the LDraw
/// library; write the target so every viewer resolves it.
fn ldraw_file(part: &str) -> &str {
    match part {
        "3023" => "3023b",
        "3040" => "3040b",
        other => other,
    }
}

/// LDraw is -Y up and right-handed like glTF, so grid (x, y, z) maps to LDraw (x, -y, -z)
/// (a 180° rotation about X, not a mirror). Parts have their origin at the top centre;
/// rectangular parts have their long side along X.
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
        // Bricks and plates have their origin on the top face; the 30° slopes on the bottom.
        let origin_y = match b.shape {
            Shape::Slope => -(b.y as f32) * h,
            Shape::Box => -((b.y + b.h as i32) as f32) * h,
        };
        let rot = match (b.shape, b.facing) {
            (Shape::Slope, Some(f)) => slope_rotation(f),
            // Long side along Z needs a 90° turn about Y.
            _ if b.d > b.w => ROT_90,
            _ => ROT_0,
        };
        let _ = writeln!(
            out,
            "1 {} {} {} {} {} {}.dat",
            b.color,
            cx,
            origin_y,
            cz,
            rot,
            ldraw_file(&b.part)
        );
    }
    let _ = writeln!(out, "0 STEP");
    out
}

pub fn bom_csv(model: &BrickModel) -> String {
    let mut out =
        String::from("part,name,color_code,color_name,count,bricklink_part,bricklink_color\n");
    for l in &model.bom {
        let _ = writeln!(
            out,
            "{},{},{},{},{},{},{}",
            l.part,
            l.name,
            l.color,
            color::name_of(l.color),
            l.count,
            l.bricklink_part.as_deref().unwrap_or(""),
            l.bricklink_color.map(|c| c.to_string()).unwrap_or_default()
        );
    }
    out
}
