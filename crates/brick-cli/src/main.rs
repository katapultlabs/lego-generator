//! brickify: GLB in, brick model out.
//!
//! brickify <input.glb> [--studs N] [--plates] [--hollow N] [--smooth N] [--attempts N]
//!          [--repair N] [--z-up] [--seed N] [--out DIR]

mod preview;

use std::path::PathBuf;
use std::time::Instant;

use brick_core::{LayerKind, Options, UpAxis, export};

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let mut input: Option<PathBuf> = None;
    let mut out = PathBuf::from("out");
    let mut opts = Options::default();
    let num = |v: Option<String>, flag: &str| -> Result<u64, String> {
        v.ok_or(format!("{flag} needs a value"))?.parse().map_err(|_| format!("{flag}: not a number"))
    };
    while let Some(a) = args.next() {
        match a.as_str() {
            "--studs" => opts.studs = num(args.next(), "--studs")? as u32,
            "--hollow" => opts.hollow = num(args.next(), "--hollow")? as u32,
            "--smooth" => opts.smooth = num(args.next(), "--smooth")? as u32,
            "--attempts" => opts.attempts = num(args.next(), "--attempts")? as u32,
            "--repair" => opts.repair = num(args.next(), "--repair")? as u32,
            "--seed" => opts.seed = num(args.next(), "--seed")?,
            "--plates" => opts.layer = LayerKind::Plate,
            "--z-up" => opts.up_axis = UpAxis::Z,
            "--out" => out = args.next().ok_or("--out needs a value")?.into(),
            "-h" | "--help" => {
                println!("{}", include_str!("main.rs").lines().nth(2).unwrap_or_default().trim_start_matches("//! "));
                return Ok(());
            }
            _ if input.is_none() && !a.starts_with('-') => input = Some(a.into()),
            _ => return Err(format!("unexpected argument {a}").into()),
        }
    }
    let input = input.ok_or("usage: brickify <input.glb> [options]")?;
    let name = input.file_stem().and_then(|s| s.to_str()).unwrap_or("model").to_string();

    let t0 = Instant::now();
    let mesh = brick_core::load_glb(&std::fs::read(&input)?)?;
    let t_load = t0.elapsed();
    let t1 = Instant::now();
    let mut model = brick_core::brickify(&mesh, &opts);
    model.stats.millis = t1.elapsed().as_secs_f64() * 1000.0;

    std::fs::create_dir_all(&out)?;
    std::fs::write(out.join(format!("{name}.json")), serde_json::to_string(&model)?)?;
    std::fs::write(out.join(format!("{name}.ldr")), export::to_ldraw(&model, &name))?;
    std::fs::write(out.join(format!("{name}.bom.csv")), export::bom_csv(&model))?;
    preview::render_preview(&model).save(out.join(format!("{name}.png")))?;

    let s = &model.stats;
    println!(
        "{name}: {} triangles, grid {}x{}x{} -> {} bricks ({} voxels), {} floating, {} components | load {:.0} ms, brickify {:.0} ms",
        mesh.triangles.len(),
        model.dims.x,
        model.dims.y,
        model.dims.z,
        s.bricks,
        s.voxels,
        s.floating_bricks,
        s.components,
        t_load.as_secs_f64() * 1000.0,
        s.millis
    );
    for w in &model.warnings {
        println!("  warning: {w}");
    }
    println!("  colors: {}", model.palette.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", "));
    println!("  wrote {}/{name}.{{json,ldr,bom.csv}}", out.display());
    Ok(())
}
