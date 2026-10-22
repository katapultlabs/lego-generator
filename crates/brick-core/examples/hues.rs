//! Debug: area-weighted hue histogram of a mesh's surface colors (Lab, chroma > 6).
//! cargo run --release -p brick-core --example hues -- model.glb

use brick_core::color::linear_to_lab;

fn main() {
    let path = std::env::args().nth(1).expect("glb path");
    let mesh = brick_core::load_glb(&std::fs::read(path).unwrap()).unwrap();
    let mut bins = [(0f32, [0f32; 3]); 12];
    let mut grey = 0f32;
    for t in &mesh.triangles {
        let (a, b, c) = (t.p[0], t.p[1], t.p[2]);
        let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        let area = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt() / 2.0;
        let lab = linear_to_lab(mesh.color_at(t, 1.0 / 3.0, 1.0 / 3.0));
        let chroma = (lab[1] * lab[1] + lab[2] * lab[2]).sqrt();
        if chroma < 6.0 {
            grey += area;
            continue;
        }
        let h = lab[2].atan2(lab[1]).to_degrees().rem_euclid(360.0);
        let bin = &mut bins[(h / 30.0) as usize % 12];
        bin.0 += area;
        for k in 0..3 {
            bin.1[k] += lab[k] * area;
        }
    }
    let total: f32 = grey + bins.iter().map(|b| b.0).sum::<f32>();
    println!("grey (chroma<6): {:.1}%", 100.0 * grey / total);
    for (i, (w, s)) in bins.iter().enumerate() {
        if *w > 0.0 {
            println!(
                "hue {:3}-{:3}: {:5.1}%  mean Lab ({:.0}, {:.0}, {:.0})",
                i * 30,
                i * 30 + 30,
                100.0 * w / total,
                s[0] / w,
                s[1] / w,
                s[2] / w
            );
        }
    }
}
