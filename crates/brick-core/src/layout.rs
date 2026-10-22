//! Voxel grid -> brick layout.
//!
//! Greedy per layer, bottom-up: at each uncovered cell try every part, orientation and offset
//! that covers it and keep the best-scoring placement (big bricks, many studs shared with the
//! layers below/above, no stacking exactly on an identical brick). Then a repair loop rips up
//! the neighbourhood of floating bricks and re-lays it with a bonus for bridging floating and
//! grounded bricks, in the spirit of Luo et al. 2015 "Legolization".
//!
//! Parts can be several layers tall: in mixed mode a layer is one plate and a brick spans
//! three, so bricks go where three layers line up and plates keep the detail elsewhere.

use crate::color::FILLER_CODE;
use crate::model::{Facing, Shape};
use crate::parts::PARTS;
use crate::voxel::{EMPTY, Grid, WILDCARD};

#[derive(Debug, Clone, Copy)]
pub struct Placement {
    pub x: usize,
    pub y: usize,
    pub z: usize,
    pub w: usize,
    pub d: usize,
    /// Height in layers.
    pub h: usize,
    pub color: u16,
    pub shape: Shape,
    pub facing: Option<Facing>,
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
    /// Part heights to try, in layers (e.g. [3, 1] = bricks and plates on a plate grid).
    heights: &'g [usize],
    /// Brick id per cell, or -1.
    owner: Vec<i32>,
    bricks: Vec<Option<Placement>>,
    /// Per brick id: belongs to the main (largest) connected piece (valid after `analyze`;
    /// during a repair refill, new parts linked to it are marked as they go).
    grounded: Vec<bool>,
    /// Per cell: belonged to a floating part that a repair just ripped up.
    orphan: Vec<bool>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct Analysis {
    pub floating: u32,
    pub components: u32,
    pub bricks: u32,
}

impl<'g> Layout<'g> {
    pub fn new(grid: &'g Grid, heights: &'g [usize]) -> Self {
        Self {
            grid,
            heights,
            owner: vec![-1; grid.cells.len()],
            bricks: Vec::new(),
            grounded: Vec::new(),
            orphan: vec![false; grid.cells.len()],
        }
    }

    /// Cells covered by a placement.
    fn cells_of(&self, p: &Placement) -> impl Iterator<Item = usize> + '_ {
        let g = self.grid;
        let (x0, y0, z0, w, d, h) = (p.x, p.y, p.z, p.w, p.d, p.h);
        (y0..y0 + h).flat_map(move |y| {
            (z0..z0 + d).flat_map(move |z| (x0..x0 + w).map(move |x| g.idx(x, y, z)))
        })
    }

    pub fn placements(&self) -> impl Iterator<Item = &Placement> {
        self.bricks.iter().flatten()
    }

    /// Lay parts over every uncovered occupied cell, bottom-up.
    pub fn fill(&mut self, rng: &mut Rng) {
        for y in 0..self.grid.ny {
            self.fill_layer(y, y % 2 == 0, 0.0, rng);
        }
    }

    /// Cover layer `y`. Tall parts (bricks on a plate grid) only start on course boundaries
    /// (every third plate), so they interlock like a brick wall; one-layer parts then fill in
    /// the surface detail the courses can't follow.
    fn fill_layer(&mut self, y: usize, prefer_long_x: bool, bridge_bonus: f32, rng: &mut Rng) {
        let heights = self.heights;
        let tall = heights.iter().copied().filter(|&h| h > 1).max();
        match tall.filter(|t| y % t == 0) {
            // While repairing, let plates compete with bricks on course layers: the fix for a
            // stranded overhang is often a plate reaching across onto a brick's top.
            Some(_) if bridge_bonus > 0.0 => self.cover_layer(y, heights, prefer_long_x, bridge_bonus, rng),
            Some(t) => {
                self.cover_layer(y, &[t], prefer_long_x, bridge_bonus, rng);
                self.cover_layer(y, &[1], prefer_long_x, bridge_bonus, rng);
            }
            None => self.cover_layer(y, &[1], prefer_long_x, bridge_bonus, rng),
        }
    }

    fn cover_layer(
        &mut self,
        y: usize,
        heights: &[usize],
        prefer_long_x: bool,
        bridge_bonus: f32,
        rng: &mut Rng,
    ) {
        let g = self.grid;
        let x_major = rng.next_f32() < 0.5;
        for k in 0..g.nx * g.nz {
            let (x, z) = if x_major {
                (k % g.nx, k / g.nx)
            } else {
                (k / g.nz, k % g.nz)
            };
            let i = g.idx(x, y, z);
            if g.cells[i] == EMPTY || self.owner[i] >= 0 {
                continue;
            }
            if let Some((p, anchored)) =
                self.best_placement(x, y, z, heights, prefer_long_x, bridge_bonus, rng)
            {
                let id = self.place(p);
                self.grounded[id] = anchored;
            }
        }
    }

    fn place(&mut self, p: Placement) -> usize {
        let id = self.bricks.len();
        let cells: Vec<usize> = self.cells_of(&p).collect();
        for i in cells {
            self.owner[i] = id as i32;
        }
        self.bricks.push(Some(p));
        self.grounded.push(false);
        id
    }

    fn remove(&mut self, id: usize) {
        if let Some(p) = self.bricks[id].take() {
            let cells: Vec<usize> = self.cells_of(&p).collect();
            for i in cells {
                self.owner[i] = -1;
            }
        }
    }

    fn best_placement(
        &self,
        cx: usize,
        y: usize,
        cz: usize,
        heights: &[usize],
        prefer_long_x: bool,
        bridge_bonus: f32,
        rng: &mut Rng,
    ) -> Option<(Placement, bool)> {
        let g = self.grid;
        let mut best: Option<(f32, Placement, bool)> = None;
        let mut below: Vec<i32> = Vec::with_capacity(16);
        let mut above: Vec<i32> = Vec::with_capacity(16);
        let mut colors: Vec<(i16, u32)> = Vec::with_capacity(4);

        for &h in heights {
            if y + h > g.ny {
                continue;
            }
            for part in PARTS {
                let (a, b) = (part.a as usize, part.b as usize);
                let orientations: &[(usize, usize)] =
                    if a == b { &[(b, a)] } else { &[(b, a), (a, b)] };
                for &(w, d) in orientations {
                    for x0 in cx.saturating_sub(w - 1)..=cx {
                        'offset: for z0 in cz.saturating_sub(d - 1)..=cz {
                            if x0 + w > g.nx || z0 + d > g.nz {
                                continue;
                            }
                            colors.clear();
                            below.clear();
                            above.clear();
                            let mut orphans = 0;
                            for (layer, z, x) in (y..y + h).flat_map(|l| {
                                (z0..z0 + d).flat_map(move |z| (x0..x0 + w).map(move |x| (l, z, x)))
                            }) {
                                let i = g.idx(x, layer, z);
                                let c = g.cells[i];
                                if c == EMPTY || self.owner[i] >= 0 {
                                    continue 'offset;
                                }
                                orphans += usize::from(self.orphan[i]);
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
                                if layer == y && y > 0 {
                                    let o = self.owner[g.idx(x, y - 1, z)];
                                    if o >= 0 && !below.contains(&o) {
                                        below.push(o);
                                    }
                                }
                                if layer + 1 == y + h && y + h < g.ny {
                                    let o = self.owner[g.idx(x, y + h, z)];
                                    if o >= 0 && !above.contains(&o) {
                                        above.push(o);
                                    }
                                }
                            }

                            // Footprint first: a wide part ties columns together, which is what
                            // holds a model up. Height earns a bonus (one brick saves two plates)
                            // but not enough for a 1x1 brick column to beat a long plate.
                            let area = (w * d) as f32 * (1.0 + 0.35 * (h as f32 - 1.0));
                            let links = (below.len() + above.len()) as f32;
                            let majority = colors.iter().max_by_key(|e| e.1).copied();
                            let off_color = colors.iter().map(|e| e.1).sum::<u32>()
                                - majority.map(|e| e.1).unwrap_or(0);
                            let mut score =
                                area + 1.2 * links + 0.3 * rng.next_f32() - 1.5 * off_color as f32;
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
                            let (mut grounded, mut floating) = (false, false);
                            if bridge_bonus > 0.0 {
                                for &o in below.iter().chain(above.iter()) {
                                    if self.grounded.get(o as usize).copied().unwrap_or(false) {
                                        grounded = true;
                                    } else {
                                        floating = true;
                                    }
                                }
                                // Reward joining a stranded part to the model, either through
                                // studs or by taking over its cells while gripping the model.
                                if grounded && (floating || orphans > 0) {
                                    score += bridge_bonus;
                                }
                                if grounded || y == 0 {
                                    score += 0.5;
                                }
                            }

                            let color = majority.map(|e| e.0 as u16).unwrap_or(FILLER_CODE);
                            let p = Placement {
                                x: x0,
                                y,
                                z: z0,
                                w,
                                d,
                                h,
                                color,
                                shape: Shape::Box,
                                facing: None,
                            };
                            if best.map(|(s, _, _)| score > s).unwrap_or(true) {
                                best = Some((score, p, grounded));
                            }
                        }
                    }
                }
            }
        }
        // With one-layer parts allowed a 1x1 always fits, so only tall-only passes return None.
        best.map(|(_, p, anchored)| (p, anchored))
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

            // Pick one floating brick (at random) and clear a dilated box around it, one layer
            // beyond it above and below.
            let pick = floating[(rng.next_f32() * floating.len() as f32) as usize % floating.len()];
            let r = 2 + (rng.next_f32() * 3.0) as usize;
            let g = self.grid;
            let (x0, x1) = (pick.x.saturating_sub(r), (pick.x + pick.w + r).min(g.nx));
            let (z0, z1) = (pick.z.saturating_sub(r), (pick.z + pick.d + r).min(g.nz));
            let (y0, y1) = (pick.y.saturating_sub(1), (pick.y + pick.h + 1).min(g.ny));
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
            // Removed parts may reach past the box vertically; refill everything they freed.
            let (mut lo, mut hi) = (y0, y1);
            for &id in &doomed {
                if let Some(p) = self.bricks[id] {
                    lo = lo.min(p.y);
                    hi = hi.max(p.y + p.h);
                }
            }
            let mut orphaned = Vec::new();
            for &id in &doomed {
                if let (Some(p), false) = (self.bricks[id], self.grounded[id]) {
                    orphaned.extend(self.cells_of(&p));
                }
            }
            for &i in &orphaned {
                self.orphan[i] = true;
            }
            for id in doomed {
                self.remove(id);
            }
            self.refill_range(lo, hi, rng);
            for &i in &orphaned {
                self.orphan[i] = false;
            }

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
        for y in y0..y1 {
            let prefer_long_x = rng.next_f32() < 0.5;
            self.fill_layer(y, prefer_long_x, 6.0, rng);
        }
    }

    /// Placements with whether each is attached to the main piece (as of the last `analyze`).
    pub fn into_placements(self) -> Vec<(Placement, bool)> {
        self.bricks
            .into_iter()
            .zip(self.grounded)
            .filter_map(|(p, g)| p.map(|p| (p, g)))
            .collect()
    }
}
