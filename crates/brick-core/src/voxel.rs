//! Mesh -> colored voxel grid on the LEGO lattice (one cell = 1 stud x 1 layer x 1 stud).

use std::collections::{HashMap, VecDeque};

use crate::color::{Lab, Matcher, linear_to_lab};
use crate::layout::Rng;
use crate::mesh::Mesh;
use crate::{Options, UpAxis};

pub const EMPTY: i16 = -1;
/// Occupied but never seen from outside: any color will do.
pub const WILDCARD: i16 = -2;

/// Cells are indexed `(y * nz + z) * nx + x`; values are `EMPTY`, `WILDCARD` or an LDraw color code.
#[derive(Debug, Clone)]
pub struct Grid {
    pub nx: usize,
    pub ny: usize,
    pub nz: usize,
    pub cells: Vec<i16>,
}

impl Grid {
    pub fn idx(&self, x: usize, y: usize, z: usize) -> usize {
        (y * self.nz + z) * self.nx + x
    }

    pub fn occupied(&self) -> usize {
        self.cells.iter().filter(|&&c| c != EMPTY).count()
    }

    fn neighbors(&self, i: usize) -> impl Iterator<Item = usize> + '_ {
        let x = i % self.nx;
        let z = (i / self.nx) % self.nz;
        let y = i / (self.nx * self.nz);
        let (nx, ny, nz) = (self.nx, self.ny, self.nz);
        let layer = nx * nz;
        [
            (x > 0).then(|| i - 1),
            (x + 1 < nx).then(|| i + 1),
            (z > 0).then(|| i - nx),
            (z + 1 < nz).then(|| i + nx),
            (y > 0).then(|| i - layer),
            (y + 1 < ny).then(|| i + layer),
        ]
        .into_iter()
        .flatten()
    }

    fn on_boundary(&self, i: usize) -> bool {
        let x = i % self.nx;
        let z = (i / self.nx) % self.nz;
        let y = i / (self.nx * self.nz);
        x == 0 || z == 0 || y == 0 || x + 1 == self.nx || z + 1 == self.nz || y + 1 == self.ny
    }
}

/// Hard cap so a huge `studs` value can't exhaust memory (notably in WASM).
const MAX_CELLS: usize = 6_000_000;

pub fn voxelize(mesh: &Mesh, opts: &Options, warnings: &mut Vec<String>) -> Grid {
    let map = |p: [f32; 3]| match opts.up_axis {
        UpAxis::Y => p,
        UpAxis::Z => [p[0], p[2], -p[1]],
    };
    let (mut lo, mut hi) = ([f32::MAX; 3], [f32::MIN; 3]);
    for t in &mesh.triangles {
        for p in t.p.iter().map(|&p| map(p)) {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
    }
    let ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    let longest = ext.iter().cloned().fold(f32::MIN, f32::max).max(1e-9);

    // Voxel size in LDU; `scale` maps mesh units to LDU so the longest axis spans `studs` studs.
    let vs = [20.0, opts.layer.height_ldu() as f32, 20.0];
    let mut studs = opts.studs.max(1) as f32;
    let dims = |studs: f32| {
        let scale = studs * 20.0 / longest;
        let n: [usize; 3] =
            std::array::from_fn(|k| ((ext[k] * scale / vs[k]).ceil() as usize).max(1));
        (scale, n)
    };
    let (mut scale, mut n) = dims(studs);
    while n[0] * n[1] * n[2] > MAX_CELLS && studs > 4.0 {
        studs *= 0.9;
        (scale, n) = dims(studs);
    }
    if studs < opts.studs as f32 {
        warnings.push(format!(
            "model too large; reduced to {} studs",
            studs as u32
        ));
    }
    let to_cell =
        |p: [f32; 3]| -> [f32; 3] { std::array::from_fn(|k| (p[k] - lo[k]) * scale / vs[k]) };

    let total = n[0] * n[1] * n[2];
    let mut grid = Grid {
        nx: n[0],
        ny: n[1],
        nz: n[2],
        cells: vec![EMPTY; total],
    };
    // Per occupied cell, area-weighted linear RGB [r, g, b, weight] binned by the facing of the
    // surface it came from (+x, -x, +y, -y, +z, -z). Lets a cell take its color from the side
    // that faces open air instead of averaging in interior surfaces (a car's headliner, seats).
    let mut acc: HashMap<usize, [[f32; 4]; 6]> = HashMap::new();

    for t in &mesh.triangles {
        let wp = [map(t.p[0]), map(t.p[1]), map(t.p[2])];
        let (e1, e2) = (sub(wp[1], wp[0]), sub(wp[2], wp[0]));
        let normal = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
        ];
        let axis = (0..3)
            .max_by(|&a, &b| normal[a].abs().total_cmp(&normal[b].abs()))
            .unwrap_or(1);
        let bin = axis * 2 + usize::from(normal[axis] < 0.0);

        let q = [to_cell(wp[0]), to_cell(wp[1]), to_cell(wp[2])];
        let e =
            |a: usize, b: usize| ((0..3).map(|k| (q[a][k] - q[b][k]).powi(2)).sum::<f32>()).sqrt();
        let longest_edge = e(0, 1).max(e(1, 2)).max(e(2, 0));
        let steps = ((longest_edge * 2.0).ceil() as usize).clamp(1, 512);
        let u = [q[1][0] - q[0][0], q[1][1] - q[0][1], q[1][2] - q[0][2]];
        let v = [q[2][0] - q[0][0], q[2][1] - q[0][1], q[2][2] - q[0][2]];
        let cross = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ];
        let area = 0.5 * (cross[0].powi(2) + cross[1].powi(2) + cross[2].powi(2)).sqrt();
        let count = (steps + 1) * (steps + 2) / 2 + 1;
        let w = area / count as f32 + 1e-6;

        let mut deposit = |bu: f32, bv: f32| {
            let bw = 1.0 - bu - bv;
            let c: [usize; 3] = std::array::from_fn(|k| {
                let p = bw * q[0][k] + bu * q[1][k] + bv * q[2][k];
                (p.max(0.0) as usize).min(n[k] - 1)
            });
            let i = grid.idx(c[0], c[1], c[2]);
            let rgb = mesh.color_at(t, bu, bv);
            let a = &mut acc.entry(i).or_insert([[0.0; 4]; 6])[bin];
            a[0] += rgb[0] * w;
            a[1] += rgb[1] * w;
            a[2] += rgb[2] * w;
            a[3] += w;
        };
        for i in 0..=steps {
            for j in 0..=(steps - i) {
                deposit(i as f32 / steps as f32, j as f32 / steps as f32);
            }
        }
        deposit(1.0 / 3.0, 1.0 / 3.0);
    }

    // Surface cells start as wildcards; visible ones get a color below.
    for &i in acc.keys() {
        grid.cells[i] = WILDCARD;
    }
    let outside = flood_outside(&grid);
    for i in 0..total {
        if grid.cells[i] == EMPTY && !outside[i] {
            grid.cells[i] = WILDCARD;
        }
    }

    // (cell, Lab color, weight) for every surface cell.
    let mut samples: Vec<(usize, Lab, f32)> = acc
        .iter()
        .map(|(&i, bins)| {
            let open = open_sides(&grid, &outside, i);
            let sum = |pick: &dyn Fn(usize) -> bool| {
                (0..6)
                    .filter(|&b| pick(b))
                    .fold([0f32; 4], |s, b| std::array::from_fn(|k| s[k] + bins[b][k]))
            };
            let mut a = sum(&|b| open[b]);
            if a[3] <= 0.0 {
                a = sum(&|_| true);
            }
            let lab = linear_to_lab([a[0] / a[3], a[1] / a[3], a[2] / a[3]]);
            (i, [lab[0], lab[1] * opts.vivid, lab[2] * opts.vivid], a[3])
        })
        .collect();
    samples.sort_unstable_by_key(|s| s.0);

    let matcher = Matcher::new(&opts.colors);
    if opts.color_count > 0 && samples.len() > opts.color_count as usize {
        // Generated textures bake lighting in (a metallic roof comes out red-brown next to a
        // red door), so snapping each cell on its own scatters near-identical surfaces across
        // palette entries. Cluster the model's colors first, then snap each cluster.
        let (centers, assignment) = kmeans(&samples, opts.color_count as usize, opts.seed);
        let target = merge_shaded(&centers);
        let codes: Vec<i16> = target
            .iter()
            .map(|&t| matcher.nearest_lab(centers[t]) as i16)
            .collect();
        for (s, &k) in samples.iter().zip(&assignment) {
            grid.cells[s.0] = codes[k];
        }
    } else {
        for s in &samples {
            grid.cells[s.0] = matcher.nearest_lab(s.1) as i16;
        }
    }

    // Depth of each occupied cell from the outside air (1 = visible).
    let depth = depth_from_outside(&grid, &outside);
    for i in 0..total {
        if grid.cells[i] == EMPTY {
            continue;
        }
        if opts.hollow > 0 && depth[i] > opts.hollow {
            grid.cells[i] = EMPTY;
        } else if depth[i] > 1 {
            grid.cells[i] = WILDCARD;
        }
    }

    let dropped = drop_islands(&mut grid);
    if dropped > 0 {
        warnings.push(format!(
            "removed {dropped} cells of loose debris not attached to the model"
        ));
    }

    for _ in 0..opts.smooth {
        smooth_colors(&mut grid);
    }
    grid
}

/// Remove 6-connected voxel islands much smaller than the main body: generator noise (a speck
/// of branch, a floating sliver) that no brick layout could attach. Returns cells removed.
fn drop_islands(grid: &mut Grid) -> usize {
    let mut label = vec![u32::MAX; grid.cells.len()];
    let mut sizes = Vec::new();
    let mut queue = VecDeque::new();
    for start in 0..grid.cells.len() {
        if grid.cells[start] == EMPTY || label[start] != u32::MAX {
            continue;
        }
        let id = sizes.len() as u32;
        let mut size = 0usize;
        label[start] = id;
        queue.push_back(start);
        while let Some(i) = queue.pop_front() {
            size += 1;
            let next: Vec<usize> = grid.neighbors(i).collect();
            for j in next {
                if grid.cells[j] != EMPTY && label[j] == u32::MAX {
                    label[j] = id;
                    queue.push_back(j);
                }
            }
        }
        sizes.push(size);
    }
    let largest = sizes.iter().copied().max().unwrap_or(0);
    let keep = |s: usize| s * 50 >= largest; // at least 2% of the main body
    let mut removed = 0;
    for (i, cell) in grid.cells.iter_mut().enumerate() {
        if *cell != EMPTY && !keep(sizes[label[i] as usize]) {
            *cell = EMPTY;
            removed += 1;
        }
    }
    removed
}

/// Weighted k-means in Lab (k-means++ seeding). Returns centers and each sample's cluster.
/// (Down-weighting lightness was tried: it rescued small hue patches but merged grey hubcaps
/// into dark windows; plain Lab with 8 clusters kept both on the bird and car samples.)
fn kmeans(samples: &[(usize, Lab, f32)], k: usize, seed: u64) -> (Vec<Lab>, Vec<usize>) {
    let d2 = |a: Lab, b: Lab| (0..3).map(|i| (a[i] - b[i]).powi(2)).sum::<f32>();
    let mut rng = Rng::new(seed ^ 0xC0105);
    let mut centers =
        vec![samples[(rng.next_f32() * samples.len() as f32) as usize % samples.len()].1];
    let mut nearest: Vec<f32> = samples.iter().map(|s| d2(s.1, centers[0]) * s.2).collect();
    while centers.len() < k {
        let total: f32 = nearest.iter().sum();
        if total <= 0.0 {
            break;
        }
        let mut target = rng.next_f32() * total;
        let pick = nearest
            .iter()
            .position(|&d| {
                target -= d;
                target <= 0.0
            })
            .unwrap_or(samples.len() - 1);
        let c = samples[pick].1;
        centers.push(c);
        for (n, s) in nearest.iter_mut().zip(samples) {
            *n = n.min(d2(s.1, c) * s.2);
        }
    }
    let mut assignment = vec![0; samples.len()];
    for _ in 0..12 {
        for (a, s) in assignment.iter_mut().zip(samples) {
            *a = (0..centers.len())
                .min_by(|&x, &y| d2(s.1, centers[x]).total_cmp(&d2(s.1, centers[y])))
                .unwrap_or(0);
        }
        let mut sums = vec![[0f32; 4]; centers.len()];
        for (&a, s) in assignment.iter().zip(samples) {
            for i in 0..3 {
                sums[a][i] += s.1[i] * s.2;
            }
            sums[a][3] += s.2;
        }
        for (c, s) in centers.iter_mut().zip(&sums) {
            if s[3] > 0.0 {
                *c = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
            }
        }
    }
    (centers, assignment)
}

/// Baked lighting changes a surface's lightness and chroma but barely its hue, and shading
/// only ever dulls the paint. Map each saturated cluster onto the most saturated cluster of
/// the same hue; returns, per cluster, the cluster whose color it should use.
fn merge_shaded(centers: &[Lab]) -> Vec<usize> {
    const MIN_CHROMA: f32 = 18.0;
    const MAX_HUE_DIFF: f32 = 14.0;
    let chroma = |c: Lab| (c[1] * c[1] + c[2] * c[2]).sqrt();
    let hue = |c: Lab| c[2].atan2(c[1]).to_degrees();
    (0..centers.len())
        .map(|c| {
            if chroma(centers[c]) < MIN_CHROMA {
                return c;
            }
            (0..centers.len())
                .filter(|&h| {
                    let dh = (hue(centers[c]) - hue(centers[h])).abs();
                    chroma(centers[h]) >= MIN_CHROMA && dh.min(360.0 - dh) < MAX_HUE_DIFF
                })
                .max_by(|&a, &b| chroma(centers[a]).total_cmp(&chroma(centers[b])))
                .unwrap_or(c)
        })
        .collect()
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/// Which of the six sides (+x, -x, +y, -y, +z, -z) of cell `i` face outside air or the grid edge.
fn open_sides(grid: &Grid, outside: &[bool], i: usize) -> [bool; 6] {
    let x = i % grid.nx;
    let z = (i / grid.nx) % grid.nz;
    let y = i / (grid.nx * grid.nz);
    let layer = grid.nx * grid.nz;
    let open = |edge: bool, j: usize| edge || outside[j];
    [
        open(x + 1 == grid.nx, if x + 1 < grid.nx { i + 1 } else { i }),
        open(x == 0, if x > 0 { i - 1 } else { i }),
        open(
            y + 1 == grid.ny,
            if y + 1 < grid.ny { i + layer } else { i },
        ),
        open(y == 0, if y > 0 { i - layer } else { i }),
        open(
            z + 1 == grid.nz,
            if z + 1 < grid.nz { i + grid.nx } else { i },
        ),
        open(z == 0, if z > 0 { i - grid.nx } else { i }),
    ]
}

/// Empty cells reachable from the grid boundary through empty cells.
fn flood_outside(grid: &Grid) -> Vec<bool> {
    let mut outside = vec![false; grid.cells.len()];
    let mut queue = VecDeque::new();
    for i in 0..grid.cells.len() {
        if grid.cells[i] == EMPTY && grid.on_boundary(i) {
            outside[i] = true;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        for j in grid.neighbors(i) {
            if !outside[j] && grid.cells[j] == EMPTY {
                outside[j] = true;
                queue.push_back(j);
            }
        }
    }
    outside
}

fn depth_from_outside(grid: &Grid, outside: &[bool]) -> Vec<u32> {
    let mut depth = vec![u32::MAX; grid.cells.len()];
    let mut queue = VecDeque::new();
    for i in 0..grid.cells.len() {
        if grid.cells[i] == EMPTY {
            continue;
        }
        let exposed = grid.on_boundary(i) || grid.neighbors(i).any(|j| outside[j]);
        if exposed {
            depth[i] = 1;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        let d = depth[i] + 1;
        let next: Vec<usize> = grid.neighbors(i).collect();
        for j in next {
            if grid.cells[j] != EMPTY && depth[j] > d {
                depth[j] = d;
                queue.push_back(j);
            }
        }
    }
    depth
}

/// Majority filter: a colored cell whose color no neighbor shares adopts the dominant neighbor color.
fn smooth_colors(grid: &mut Grid) {
    let snapshot = grid.cells.clone();
    for i in 0..snapshot.len() {
        let own = snapshot[i];
        if own < 0 {
            continue;
        }
        let mut counts: Vec<(i16, u32)> = Vec::with_capacity(6);
        let mut same = 0;
        for j in grid.neighbors(i) {
            let c = snapshot[j];
            if c < 0 {
                continue;
            }
            if c == own {
                same += 1;
            }
            match counts.iter_mut().find(|e| e.0 == c) {
                Some(e) => e.1 += 1,
                None => counts.push((c, 1)),
            }
        }
        if same == 0 {
            if let Some(&(c, k)) = counts.iter().max_by_key(|e| e.1) {
                if k >= 2 {
                    grid.cells[i] = c;
                }
            }
        }
    }
}
