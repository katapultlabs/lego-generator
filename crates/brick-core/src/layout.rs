//! Voxel grid -> brick layout.
//!
//! Greedy per layer, bottom-up: at each uncovered cell try every part, orientation and offset
//! that covers it and keep the best-scoring placement (big bricks, many studs shared with the
//! layers below/above, no stacking exactly on an identical brick). Then a repair loop rips up
//! the neighbourhood of floating bricks and re-lays it with a bonus for bridging floating and
//! grounded bricks, in the spirit of Luo et al. 2015 "Legolization".

use crate::color::FILLER_CODE;
use crate::parts::PARTS;
use crate::voxel::{EMPTY, Grid, WILDCARD};

#[derive(Debug, Clone, Copy)]
pub struct Placement {
    pub x: usize,
    pub y: usize,
    pub z: usize,
    pub w: usize,
    pub d: usize,
    pub color: u16,
}

pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1)
    }
    pub fn next_f32(&mut self) -> f32 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        ((self.0.wrapping_mul(0x2545F4914F6CDD1D) >> 40) as f32) / (1u64 << 24) as f32
    }
}

pub struct Layout<'g> {
    grid: &'g Grid,
    /// Brick id per cell, or -1.
    owner: Vec<i32>,
    bricks: Vec<Option<Placement>>,
    /// Per brick id: belongs to the main (largest) connected piece (valid after `analyze`).
    grounded: Vec<bool>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Analysis {
    pub floating: u32,
    pub components: u32,
    pub bricks: u32,
}

impl<'g> Layout<'g> {
    pub fn new(grid: &'g Grid) -> Self {
        Self { grid, owner: vec![-1; grid.cells.len()], bricks: Vec::new(), grounded: Vec::new() }
    }

    pub fn placements(&self) -> impl Iterator<Item = &Placement> {
        self.bricks.iter().flatten()
    }

    fn layer_cells(&self, y: usize) -> std::ops::Range<usize> {
        let n = self.grid.nx * self.grid.nz;
        y * n..(y + 1) * n
    }

    /// Lay bricks over every uncovered occupied cell, bottom-up.
    pub fn fill(&mut self, rng: &mut Rng, bridge_bonus: f32) {
        let g = self.grid;
        for y in 0..g.ny {
            let x_major = (y + (rng.next_f32() * 2.0) as usize) % 2 == 0;
            let prefer_long_x = y % 2 == 0;
            for k in 0..g.nx * g.nz {
                let (x, z) = if x_major { (k % g.nx, k / g.nx) } else { (k / g.nz, k % g.nz) };
                let i = g.idx(x, y, z);
                if g.cells[i] == EMPTY || self.owner[i] >= 0 {
                    continue;
                }
                let p = self.best_placement(x, y, z, prefer_long_x, bridge_bonus, rng);
                self.place(p);
            }
        }
    }

    fn place(&mut self, p: Placement) {
        let id = self.bricks.len() as i32;
        for z in p.z..p.z + p.d {
            for x in p.x..p.x + p.w {
                let i = self.grid.idx(x, p.y, z);
                self.owner[i] = id;
            }
        }
        self.bricks.push(Some(p));
        self.grounded.push(false);
    }

    fn remove(&mut self, id: usize) {
        if let Some(p) = self.bricks[id].take() {
            for z in p.z..p.z + p.d {
                for x in p.x..p.x + p.w {
                    let i = self.grid.idx(x, p.y, z);
                    self.owner[i] = -1;
                }
            }
        }
    }

    fn best_placement(
        &self,
        cx: usize,
        y: usize,
        cz: usize,
        prefer_long_x: bool,
        bridge_bonus: f32,
        rng: &mut Rng,
    ) -> Placement {
        let g = self.grid;
        let mut best: Option<(f32, Placement)> = None;
        let mut below: Vec<i32> = Vec::with_capacity(16);
        let mut above: Vec<i32> = Vec::with_capacity(16);
        let mut colors: Vec<(i16, u32)> = Vec::with_capacity(4);

        for part in PARTS {
            let (a, b) = (part.a as usize, part.b as usize);
            let orientations: &[(usize, usize)] = if a == b { &[(b, a)] } else { &[(b, a), (a, b)] };
            for &(w, d) in orientations {
                for x0 in cx.saturating_sub(w - 1)..=cx {
                    'offset: for z0 in cz.saturating_sub(d - 1)..=cz {
                        if x0 + w > g.nx || z0 + d > g.nz {
                            continue;
                        }
                        colors.clear();
                        below.clear();
                        above.clear();
                        for z in z0..z0 + d {
                            for x in x0..x0 + w {
                                let i = g.idx(x, y, z);
                                let c = g.cells[i];
                                if c == EMPTY || self.owner[i] >= 0 {
                                    continue 'offset;
                                }
                                if c != WILDCARD {
                                    if let Some(e) = colors.iter_mut().find(|e| e.0 == c) {
                                        e.1 += 1;
                                    } else if colors.is_empty() || bridge_bonus > 0.0 {
                                        // Mixed colors only while repairing: a bridge across a
                                        // color boundary beats a part that falls off.
                                        colors.push((c, 1));
                                    } else {
                                        continue 'offset;
                                    }
                                }
                                if y > 0 {
                                    let o = self.owner[g.idx(x, y - 1, z)];
                                    if o >= 0 && !below.contains(&o) {
                                        below.push(o);
                                    }
                                }
                                if y + 1 < g.ny {
                                    let o = self.owner[g.idx(x, y + 1, z)];
                                    if o >= 0 && !above.contains(&o) {
                                        above.push(o);
                                    }
                                }
                            }
                        }

                        let area = (w * d) as f32;
                        let links = (below.len() + above.len()) as f32;
                        let majority = colors.iter().max_by_key(|e| e.1).copied();
                        let off_color = colors.iter().map(|e| e.1).sum::<u32>() - majority.map(|e| e.1).unwrap_or(0);
                        let mut score = area + 1.2 * links + 0.3 * rng.next_f32() - 1.5 * off_color as f32;
                        if (w > d) == prefer_long_x && w != d {
                            score += 0.25;
                        }
                        // Stacking exactly on an identical footprint builds weak columns.
                        let same = |id: i32| {
                            self.bricks[id as usize]
                                .map(|q| q.x == x0 && q.z == z0 && q.w == w && q.d == d)
                                .unwrap_or(false)
                        };
                        if below.len() == 1 && same(below[0]) {
                            score -= 2.0;
                        }
                        if above.len() == 1 && same(above[0]) {
                            score -= 2.0;
                        }
                        if bridge_bonus > 0.0 {
                            let linked = below.iter().chain(above.iter());
                            let (mut grounded, mut floating) = (false, false);
                            for &o in linked {
                                if self.grounded.get(o as usize).copied().unwrap_or(false) {
                                    grounded = true;
                                } else {
                                    floating = true;
                                }
                            }
                            if grounded && floating {
                                score += bridge_bonus;
                            }
                            if grounded || y == 0 {
                                score += 0.5;
                            }
                        }

                        let p = Placement { x: x0, y, z: z0, w, d, color: majority.map(|e| e.0 as u16).unwrap_or(FILLER_CODE) };
                        if best.map(|(s, _)| score > s).unwrap_or(true) {
                            best = Some((score, p));
                        }
                    }
                }
            }
        }
        // A 1x1 always fits the cell itself, so `best` is set.
        best.expect("1x1 always fits").1
    }

    /// Union bricks that share studs vertically; mark the largest component as grounded.
    pub fn analyze(&mut self) -> Analysis {
        let n = self.bricks.len();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(p: &mut [usize], mut i: usize) -> usize {
            while p[i] != i {
                p[i] = p[p[i]];
                i = p[i];
            }
            i
        }
        let g = self.grid;
        let layer = g.nx * g.nz;
        for i in layer..g.cells.len() {
            let (a, b) = (self.owner[i], self.owner[i - layer]);
            if a >= 0 && b >= 0 {
                let (ra, rb) = (find(&mut parent, a as usize), find(&mut parent, b as usize));
                if ra != rb {
                    parent[ra] = rb;
                }
            }
        }
        // The model is the largest stud-connected piece; anything else falls off when you lift
        // it. (Requiring contact with the bottom layer misfires on birds and the like, whose
        // lowest point is a foot connected sideways to the body.)
        let mut size = vec![0u32; n];
        for id in 0..n {
            if self.bricks[id].is_some() {
                let r = find(&mut parent, id);
                size[r] += 1;
            }
        }
        let main = (0..n).max_by_key(|&r| size[r]);
        let mut root_grounded = vec![false; n];
        if let Some(main) = main {
            root_grounded[main] = true;
        }
        let mut roots = std::collections::HashSet::new();
        let mut a = Analysis::default();
        for id in 0..n {
            if self.bricks[id].is_none() {
                self.grounded[id] = false;
                continue;
            }
            let r = find(&mut parent, id);
            roots.insert(r);
            self.grounded[id] = root_grounded[r];
            a.bricks += 1;
            if !root_grounded[r] {
                a.floating += 1;
            }
        }
        a.components = roots.len() as u32;
        a
    }

    /// Rip up the neighbourhood of floating bricks and re-lay it, keeping changes that help.
    pub fn repair(&mut self, rng: &mut Rng, iterations: u32) -> Analysis {
        let mut current = self.analyze();
        for _ in 0..iterations {
            if current.floating == 0 {
                break;
            }
            let snapshot = (self.owner.clone(), self.bricks.clone());
            let floating: Vec<Placement> = self
                .bricks
                .iter()
                .enumerate()
                .filter_map(|(id, p)| p.filter(|_| !self.grounded[id]))
                .collect();

            // Pick one floating brick (at random) and clear a dilated box around it on y-1..=y+1.
            let pick = floating[(rng.next_f32() * floating.len() as f32) as usize % floating.len()];
            let r = 2 + (rng.next_f32() * 3.0) as usize;
            let g = self.grid;
            let (x0, x1) = (pick.x.saturating_sub(r), (pick.x + pick.w + r).min(g.nx));
            let (z0, z1) = (pick.z.saturating_sub(r), (pick.z + pick.d + r).min(g.nz));
            let (y0, y1) = (pick.y.saturating_sub(1), (pick.y + 2).min(g.ny));
            let mut doomed = Vec::new();
            for y in y0..y1 {
                for z in z0..z1 {
                    for x in x0..x1 {
                        let o = self.owner[g.idx(x, y, z)];
                        if o >= 0 && !doomed.contains(&(o as usize)) {
                            doomed.push(o as usize);
                        }
                    }
                }
            }
            for id in doomed {
                self.remove(id);
            }
            self.refill_range(y0, y1, rng);

            let next = self.analyze();
            if next.floating < current.floating
                || (next.floating == current.floating && next.bricks <= current.bricks)
            {
                current = next;
            } else {
                (self.owner, self.bricks) = snapshot;
                self.grounded.truncate(self.bricks.len());
                current = self.analyze();
            }
        }
        current
    }

    fn refill_range(&mut self, y0: usize, y1: usize, rng: &mut Rng) {
        let g = self.grid;
        for y in y0..y1 {
            let prefer_long_x = rng.next_f32() < 0.5;
            for i in self.layer_cells(y) {
                if g.cells[i] == EMPTY || self.owner[i] >= 0 {
                    continue;
                }
                let x = i % g.nx;
                let z = (i / g.nx) % g.nz;
                let p = self.best_placement(x, y, z, prefer_long_x, 6.0, rng);
                self.place(p);
            }
        }
    }

    pub fn into_placements(self) -> Vec<Placement> {
        self.bricks.into_iter().flatten().collect()
    }
}
