//! Smooth stair-stepped surfaces with 30° "cheese" slopes (1 x 1, two plates tall).
//!
//! A voxelized incline is a staircase: a top surface with a wall rising behind it. Builders fill
//! those inner corners with slopes, which is what this pass does on a plate-height grid: on any
//! exposed top cell with a full-height wall at least two plates tall directly behind it and open
//! air in front, sit a slope that rises toward the wall. Slopes clutch the studs of the part
//! they sit on, so they never float.

use crate::layout::Placement;
use crate::model::{Facing, Shape};
use crate::parts::CHEESE_SLOPE_LAYERS;
use crate::voxel::Grid;

pub fn add_slopes(grid: &Grid, parts: &[Placement]) -> Vec<Placement> {
    let (nx, ny, nz) = (grid.nx, grid.ny, grid.nz);
    // Color of the part covering each cell, or -1.
    let mut solid = vec![-1i32; grid.cells.len()];
    for p in parts.iter().filter(|p| p.shape == Shape::Box) {
        for y in p.y..p.y + p.h {
            for z in p.z..p.z + p.d {
                for x in p.x..p.x + p.w {
                    solid[grid.idx(x, y, z)] = p.color as i32;
                }
            }
        }
    }
    let mut taken = vec![false; grid.cells.len()];
    let at = |x: i32, y: usize, z: i32| -> Option<usize> {
        (x >= 0 && z >= 0 && (x as usize) < nx && (z as usize) < nz && y < ny)
            .then(|| grid.idx(x as usize, y, z as usize))
    };

    let mut slopes = Vec::new();
    for y in 0..ny.saturating_sub(CHEESE_SLOPE_LAYERS) {
        for z in 0..nz as i32 {
            for x in 0..nx as i32 {
                let base = at(x, y, z).expect("in bounds");
                if solid[base] < 0 {
                    continue;
                }
                let room = (1..=CHEESE_SLOPE_LAYERS)
                    .all(|k| at(x, y + k, z).is_some_and(|i| solid[i] < 0 && !taken[i]));
                if !room {
                    continue;
                }
                for facing in Facing::ALL {
                    let (dx, dz) = facing.delta();
                    let wall = (1..=CHEESE_SLOPE_LAYERS)
                        .all(|k| at(x - dx, y + k, z - dz).is_some_and(|i| solid[i] >= 0));
                    let open = at(x + dx, y + 1, z + dz).is_none_or(|i| solid[i] < 0);
                    if !(wall && open) {
                        continue;
                    }
                    let color = solid[at(x - dx, y + 1, z - dz).expect("wall in bounds")] as u16;
                    for k in 1..=CHEESE_SLOPE_LAYERS {
                        taken[at(x, y + k, z).expect("room in bounds")] = true;
                    }
                    slopes.push(Placement {
                        x: x as usize,
                        y: y + 1,
                        z: z as usize,
                        w: 1,
                        d: 1,
                        h: CHEESE_SLOPE_LAYERS,
                        color,
                        shape: Shape::Slope,
                        facing: Some(facing),
                    });
                    break;
                }
            }
        }
    }
    slopes
}
