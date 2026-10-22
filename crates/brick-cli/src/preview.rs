//! Quick isometric PNG preview of a brick model (two opposite corners, side by side).

use brick_core::{BrickModel, Shape, color};
use image::{Rgb, RgbImage};

const A: f32 = 8.0; // half-width of a cell's diamond, in pixels

fn shade(rgb: u32, k: f32) -> Rgb<u8> {
    let c = |s: u32| ((((rgb >> s) & 0xFF) as f32) * k).clamp(0.0, 255.0) as u8;
    Rgb([c(16), c(8), c(0)])
}

fn fill(img: &mut RgbImage, poly: &[(f32, f32)], color: Rgb<u8>) {
    let (mut x0, mut x1, mut y0, mut y1) = (f32::MAX, f32::MIN, f32::MAX, f32::MIN);
    for &(x, y) in poly {
        x0 = x0.min(x);
        x1 = x1.max(x);
        y0 = y0.min(y);
        y1 = y1.max(y);
    }
    for py in (y0.floor().max(0.0) as u32)..(y1.ceil().min(img.height() as f32) as u32) {
        for px in (x0.floor().max(0.0) as u32)..(x1.ceil().min(img.width() as f32) as u32) {
            let (x, y) = (px as f32 + 0.5, py as f32 + 0.5);
            let mut sign = 0.0f32;
            let inside = (0..poly.len()).all(|i| {
                let (ax, ay) = poly[i];
                let (bx, by) = poly[(i + 1) % poly.len()];
                let c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
                if c.abs() < 1e-6 {
                    return true;
                }
                if sign == 0.0 {
                    sign = c.signum();
                }
                c.signum() == sign
            });
            if inside {
                img.put_pixel(px, py, color);
            }
        }
    }
}

fn render(model: &BrickModel, flip: bool) -> RgbImage {
    let h = A * model.units.layer_ldu as f32 / 20.0 * 1.2;
    let (nx, ny, nz) = (model.dims.x as i32, model.dims.y as i32, model.dims.z as i32);
    let width = ((nx + nz) as f32 * A + 4.0 * A) as u32;
    let height = ((nx + nz) as f32 * A / 2.0 + ny as f32 * h + 4.0 * A) as u32;
    let mut img = RgbImage::from_pixel(width, height, Rgb([238, 240, 243]));
    let ox = nz as f32 * A + 2.0 * A;
    let oy = ny as f32 * h + 2.0 * A;

    // One entry per cell: (x, y, z, color, brick index) in view coordinates.
    let mut cells = Vec::new();
    for (bi, b) in model.bricks.iter().enumerate() {
        // Slopes are drawn as their lower half, which reads as a step-down.
        let top = if b.shape == Shape::Slope { b.y + 1 } else { b.y + b.h as i32 };
        for y in b.y..top {
            for z in b.z..b.z + b.d as i32 {
                for x in b.x..b.x + b.w as i32 {
                    let (vx, vz) = if flip { (nx - 1 - x, nz - 1 - z) } else { (x, z) };
                    cells.push((vx, y, vz, color::rgb_of(b.color), bi));
                }
            }
        }
    }
    cells.sort_by_key(|c| (c.0 + c.2, c.1));
    for (x, y, z, rgb, bi) in cells {
        // Per-brick brightness jitter makes brick boundaries visible.
        let j = 0.92 + ((bi * 2654435761) % 17) as f32 / 100.0;
        let p = |cx: f32, cy: f32, cz: f32| (ox + (cx - cz) * A, oy + (cx + cz) * A / 2.0 - cy * h);
        let (xf, yf, zf) = (x as f32, y as f32, z as f32);
        let top = [p(xf, yf + 1.0, zf), p(xf + 1.0, yf + 1.0, zf), p(xf + 1.0, yf + 1.0, zf + 1.0), p(xf, yf + 1.0, zf + 1.0)];
        let left = [p(xf, yf, zf + 1.0), p(xf + 1.0, yf, zf + 1.0), p(xf + 1.0, yf + 1.0, zf + 1.0), p(xf, yf + 1.0, zf + 1.0)];
        let right = [p(xf + 1.0, yf, zf), p(xf + 1.0, yf, zf + 1.0), p(xf + 1.0, yf + 1.0, zf + 1.0), p(xf + 1.0, yf + 1.0, zf)];
        fill(&mut img, &left, shade(rgb, 0.78 * j));
        fill(&mut img, &right, shade(rgb, 0.62 * j));
        fill(&mut img, &top, shade(rgb, 1.0 * j));
    }
    img
}

pub fn render_preview(model: &BrickModel) -> RgbImage {
    let a = render(model, false);
    let b = render(model, true);
    let mut out = RgbImage::from_pixel(a.width() + b.width(), a.height().max(b.height()), Rgb([238, 240, 243]));
    image::imageops::overlay(&mut out, &a, 0, 0);
    image::imageops::overlay(&mut out, &b, a.width() as i64, 0);
    out
}
