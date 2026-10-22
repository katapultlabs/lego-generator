//! brick-core: turn a 3D mesh into a buildable brick model.
//!
//! Pipeline: GLB -> colored triangles -> voxel grid on the stud lattice -> greedy brick/plate
//! layout with a connectivity repair loop -> slopes on stair-steps -> build steps ->
//! [`BrickModel`] (+ LDraw / CSV / BrickLink exports).

pub mod bricklink;
pub mod color;
pub mod export;
pub mod layout;
pub mod mesh;
pub mod model;
pub mod parts;
pub mod slopes;
pub mod voxel;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub use mesh::Mesh;
pub use model::*;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("could not read glTF: {0}")]
    Gltf(#[from] gltf::Error),
    #[error("mesh has no triangles")]
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum UpAxis {
    #[default]
    Y,
    Z,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    /// Size of the longest axis, in studs (a stud is 8 mm).
    pub studs: u32,
    pub layer: LayerKind,
    /// 0 = solid; N = keep an N-cell thick shell.
    pub hollow: u32,
    /// Reduce the model to this many colors before snapping to the palette; 0 = no reduction.
    pub color_count: u32,
    /// Chroma multiplier applied before palette matching; generated textures are washed out.
    pub vivid: f32,
    /// Color majority-filter passes.
    pub smooth: u32,
    /// Smooth stair-steps with 30° slopes (plate-height grids only).
    pub slopes: bool,
    /// Most parts per build step.
    pub step_size: u32,
    /// Independent layout restarts; the best result wins.
    pub attempts: u32,
    /// Rip-up-and-retry iterations per attempt for floating bricks.
    pub repair: u32,
    pub up_axis: UpAxis,
    /// Allowed LDraw color codes; empty = the full palette.
    pub colors: Vec<u16>,
    pub seed: u64,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            studs: 32,
            layer: LayerKind::Mixed,
            hollow: 0,
            color_count: 8,
            vivid: 1.3,
            smooth: 1,
            slopes: true,
            step_size: 12,
            attempts: 6,
            repair: 60,
            up_axis: UpAxis::Y,
            colors: Vec::new(),
            seed: 1,
        }
    }
}

pub fn load_glb(bytes: &[u8]) -> Result<Mesh, Error> {
    mesh::load_glb(bytes)
}

/// Part heights tried by the layout, in layers.
fn heights(kind: LayerKind) -> &'static [usize] {
    match kind {
        LayerKind::Mixed => &[3, 1],
        LayerKind::Brick | LayerKind::Plate => &[1],
    }
}

/// Run the whole pipeline on an already-loaded mesh. `stats.millis` is left for the caller.
pub fn brickify(mesh: &Mesh, opts: &Options) -> BrickModel {
    let mut warnings = mesh.warnings.clone();
    let grid = voxel::voxelize(mesh, opts, &mut warnings);
    let kind = opts.layer;

    let mut best: Option<(layout::Analysis, Vec<(layout::Placement, bool)>)> = None;
    let attempts = opts.attempts.max(1);
    for attempt in 0..attempts {
        let mut rng = layout::Rng::new(opts.seed.wrapping_add(attempt as u64 * 7919));
        let mut lay = layout::Layout::new(&grid, heights(kind));
        lay.fill(&mut rng);
        let analysis = lay.repair(&mut rng, opts.repair);
        let better = match &best {
            None => true,
            Some((b, _)) => (analysis.floating, analysis.bricks) < (b.floating, b.bricks),
        };
        if better {
            best = Some((analysis, lay.into_placements()));
        }
    }
    let (analysis, mut placements) = best.expect("at least one attempt");
    // Cheese slopes are two plates tall, so they only fit a plate-height grid.
    if opts.slopes && kind != LayerKind::Brick {
        let boxes: Vec<layout::Placement> = placements.iter().map(|(p, _)| *p).collect();
        let slopes = slopes::add_slopes(&grid, &boxes);
        placements.extend(slopes.into_iter().map(|p| (p, true)));
    }

    let mut bricks: Vec<Brick> = placements
        .iter()
        .map(|(p, attached)| Brick {
            part: parts::identify(p.w as u32, p.d as u32, p.h as u32, kind, p.shape)
                .expect("placed part exists")
                .0
                .to_string(),
            x: p.x as i32,
            y: p.y as i32,
            z: p.z as i32,
            w: p.w as u32,
            d: p.d as u32,
            h: p.h as u32,
            shape: p.shape,
            facing: p.facing,
            color: p.color,
            step: 0,
            floating: !attached,
        })
        .collect();
    let steps = assign_steps(&mut bricks, opts.step_size.max(1) as usize);

    let mut counts: BTreeMap<(String, u16), u32> = BTreeMap::new();
    for b in &bricks {
        *counts.entry((b.part.clone(), b.color)).or_default() += 1;
    }
    let mut bom: Vec<BomLine> = counts
        .into_iter()
        .map(|((part, color), count)| BomLine {
            name: parts::name_of(&part),
            bricklink_part: bricklink::part_id(&part).map(str::to_string),
            bricklink_color: bricklink::color_id(color),
            part,
            color,
            count,
        })
        .collect();
    bom.sort_by(|a, b| b.count.cmp(&a.count).then(a.part.cmp(&b.part)));

    let mut used: Vec<u16> = bricks.iter().map(|b| b.color).collect();
    used.sort_unstable();
    used.dedup();
    let palette = used
        .into_iter()
        .map(|code| Color {
            code,
            name: color::name_of(code).to_string(),
            hex: color::hex(color::rgb_of(code)),
        })
        .collect();

    if analysis.floating > 0 {
        warnings.push(format!(
            "{} parts are not attached to the main model (thin or overhanging features)",
            analysis.floating
        ));
    }

    BrickModel {
        version: 2,
        units: Units {
            stud_ldu: 20,
            layer_ldu: kind.height_ldu(),
            layer: kind,
        },
        dims: Dims {
            x: grid.nx as u32,
            y: grid.ny as u32,
            z: grid.nz as u32,
        },
        palette,
        stats: Stats {
            bricks: bricks.len() as u32,
            voxels: grid.occupied() as u32,
            layers: grid.ny as u32,
            steps,
            floating_bricks: analysis.floating,
            components: analysis.components,
            attempts,
            millis: 0.0,
        },
        bricks,
        bom,
        warnings,
    }
}

/// Number build steps bottom-up: a part goes in once everything below its bottom layer is in.
/// Parts sharing a bottom layer are split into steps of at most `max` parts, walking rows so
/// each step covers one area of the model. Sorts `bricks` in build order; returns the step count.
fn assign_steps(bricks: &mut [Brick], max: usize) -> u32 {
    bricks.sort_by_key(|b| (b.y, b.z, b.x));
    let mut step = 0;
    let mut start = 0;
    while start < bricks.len() {
        let y = bricks[start].y;
        let end = bricks[start..]
            .iter()
            .position(|b| b.y != y)
            .map_or(bricks.len(), |n| start + n);
        for chunk in bricks[start..end].chunks_mut(max) {
            step += 1;
            for b in chunk {
                b.step = step;
            }
        }
        start = end;
    }
    step
}
