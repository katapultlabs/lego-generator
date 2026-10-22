//! Debug: average texture color of up/down-facing triangles near the top of a mesh.
//! cargo run --release -p brick-core --example probe -- model.glb

fn main() {
    let path = std::env::args().nth(1).expect("glb path");
    let mesh = brick_core::load_glb(&std::fs::read(path).unwrap()).unwrap();
    let (lo, hi) = mesh.bounds().unwrap();
    println!("bounds {lo:?} {hi:?}");
    println!("textures {:?}", mesh.textures.iter().map(|t| (t.width, t.height)).collect::<Vec<_>>());
    for m in &mesh.materials {
        println!("material base {:?} tex {:?}", m.base, m.texture);
    }
    let cut = lo[1] + 0.9 * (hi[1] - lo[1]);
    let (mut up, mut down) = ([0f32; 4], [0f32; 4]);
    for t in &mesh.triangles {
        if (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3.0 < cut {
            continue;
        }
        let e1: Vec<f32> = (0..3).map(|k| t.p[1][k] - t.p[0][k]).collect();
        let e2: Vec<f32> = (0..3).map(|k| t.p[2][k] - t.p[0][k]).collect();
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        let ny = n[1] / (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-12);
        let col = mesh.color_at(t, 1.0 / 3.0, 1.0 / 3.0);
        let acc = if ny > 0.7 { &mut up } else if ny < -0.7 { &mut down } else { continue };
        for k in 0..3 {
            acc[k] += col[k];
        }
        acc[3] += 1.0;
    }
    for (name, a) in [("up-facing", up), ("down-facing", down)] {
        let s: Vec<u8> = (0..3).map(|k| ((a[k] / a[3].max(1.0)).powf(1.0 / 2.2) * 255.0) as u8).collect();
        println!("{name}: {} tris, approx sRGB {s:?}", a[3]);
    }
}
