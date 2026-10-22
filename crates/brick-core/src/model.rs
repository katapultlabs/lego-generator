//! The brick model: the contract shared by the CLI, the web viewer and (later) native apps.
//!
//! Coordinates are a grid: `x` and `z` in studs, `y` in layers (one layer = one brick or one
//! plate tall, see [`Units`]). `y` is up. A brick occupies cells `x..x+w`, `y`, `z..z+d`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LayerKind {
    #[default]
    Brick,
    Plate,
}

impl LayerKind {
    /// Height of one layer in LDraw units (1 stud = 20 LDU).
    pub fn height_ldu(self) -> u32 {
        match self {
            LayerKind::Brick => 24,
            LayerKind::Plate => 8,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Units {
    /// Width of one stud in LDraw units (always 20).
    pub stud_ldu: u32,
    /// Height of one layer in LDraw units (24 for bricks, 8 for plates).
    pub layer_ldu: u32,
    pub layer: LayerKind,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Dims {
    pub x: u32,
    pub y: u32,
    pub z: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Color {
    /// LDraw color code (LDConfig.ldr).
    pub code: u16,
    pub name: String,
    /// sRGB hex, e.g. "#B40000".
    pub hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Brick {
    /// LDraw part number, e.g. "3001".
    pub part: String,
    pub x: i32,
    pub y: i32,
    pub z: i32,
    /// Footprint along x, in studs.
    pub w: u32,
    /// Footprint along z, in studs.
    pub d: u32,
    /// LDraw color code.
    pub color: u16,
    /// 1-based build step.
    pub step: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BomLine {
    pub part: String,
    pub name: String,
    pub color: u16,
    pub count: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub bricks: u32,
    /// Occupied voxels after filling/hollowing.
    pub voxels: u32,
    pub layers: u32,
    pub steps: u32,
    /// Bricks not connected (through studs) to anything touching the ground layer.
    pub floating_bricks: u32,
    /// Connected brick components; 1 means the whole model holds together.
    pub components: u32,
    /// Restarts of the layout search that were tried.
    pub attempts: u32,
    pub millis: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrickModel {
    pub version: u32,
    pub units: Units,
    pub dims: Dims,
    /// Colors used by the model.
    pub palette: Vec<Color>,
    pub bricks: Vec<Brick>,
    pub bom: Vec<BomLine>,
    pub stats: Stats,
    pub warnings: Vec<String>,
}
