//! Loading a GLB into a flat list of colored triangles in world space.


use crate::Error;

pub type Vec3 = [f32; 3];

#[derive(Debug, Clone)]
pub struct Texture {
    pub width: u32,
    pub height: u32,
    /// sRGB-encoded RGBA8.
    pub rgba: Vec<u8>,
}

impl Texture {
    /// Nearest-neighbour sample with repeat wrapping, returned as linear RGB.
    pub fn sample_linear(&self, uv: [f32; 2]) -> [f32; 3] {
        let u = uv[0] - uv[0].floor();
        let v = uv[1] - uv[1].floor();
        let x = ((u * self.width as f32) as u32).min(self.width - 1);
        let y = ((v * self.height as f32) as u32).min(self.height - 1);
        let i = ((y * self.width + x) * 4) as usize;
        [
            srgb_to_linear(self.rgba[i]),
            srgb_to_linear(self.rgba[i + 1]),
            srgb_to_linear(self.rgba[i + 2]),
        ]
    }
}

pub fn srgb_to_linear(c: u8) -> f32 {
    let c = c as f32 / 255.0;
    if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
}

#[derive(Debug, Clone)]
pub struct Material {
    /// Linear RGBA base color factor.
    pub base: [f32; 4],
    pub texture: Option<usize>,
}

#[derive(Debug, Clone)]
pub struct Triangle {
    pub p: [Vec3; 3],
    pub uv: Option<[[f32; 2]; 3]>,
    /// Linear vertex colors.
    pub color: Option<[[f32; 3]; 3]>,
    pub material: usize,
}

#[derive(Debug, Clone, Default)]
pub struct Mesh {
    pub triangles: Vec<Triangle>,
    pub materials: Vec<Material>,
    pub textures: Vec<Texture>,
    pub warnings: Vec<String>,
}

impl Mesh {
    /// Linear RGB color at barycentric coordinates (u, v) of a triangle.
    pub fn color_at(&self, t: &Triangle, u: f32, v: f32) -> [f32; 3] {
        let w = 1.0 - u - v;
        let m = &self.materials[t.material];
        let mut c = [m.base[0], m.base[1], m.base[2]];
        if let (Some(tex), Some(uv)) = (m.texture, t.uv) {
            let p = [
                w * uv[0][0] + u * uv[1][0] + v * uv[2][0],
                w * uv[0][1] + u * uv[1][1] + v * uv[2][1],
            ];
            let s = self.textures[tex].sample_linear(p);
            c = [c[0] * s[0], c[1] * s[1], c[2] * s[2]];
        }
        if let Some(vc) = t.color {
            for k in 0..3 {
                c[k] *= w * vc[0][k] + u * vc[1][k] + v * vc[2][k];
            }
        }
        c
    }

    pub fn bounds(&self) -> Option<(Vec3, Vec3)> {
        let mut it = self.triangles.iter().flat_map(|t| t.p.iter());
        let first = *it.next()?;
        let (mut lo, mut hi) = (first, first);
        for p in it {
            for k in 0..3 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        Some((lo, hi))
    }

    /// Rotate a Z-up mesh into Y-up (x, y, z) -> (x, z, -y).
    pub fn z_up_to_y_up(&mut self) {
        for t in &mut self.triangles {
            for p in &mut t.p {
                *p = [p[0], p[2], -p[1]];
            }
        }
    }
}

type Mat4 = [[f32; 4]; 4];

fn mul(a: &Mat4, b: &Mat4) -> Mat4 {
    // Column-major: m[col][row].
    let mut r = [[0.0; 4]; 4];
    for c in 0..4 {
        for row in 0..4 {
            r[c][row] = (0..4).map(|k| a[k][row] * b[c][k]).sum();
        }
    }
    r
}

fn transform(m: &Mat4, p: [f32; 3]) -> Vec3 {
    let mut r = [0.0; 3];
    for row in 0..3 {
        r[row] = m[0][row] * p[0] + m[1][row] * p[1] + m[2][row] * p[2] + m[3][row];
    }
    r
}

/// The gltf crate rejects `EXT_texture_webp` (TRELLIS.2 on fal emits it). Point each texture's
/// `source` at its WebP image and drop the extension from `extensionsRequired`; we decode
/// images ourselves.
fn patch_webp(json: &[u8]) -> Result<Vec<u8>, Error> {
    let mut root: serde_json::Value = serde_json::from_slice(json).map_err(|_| Error::Empty)?;
    if let Some(textures) = root.get_mut("textures").and_then(|t| t.as_array_mut()) {
        for t in textures {
            let webp = t.pointer("/extensions/EXT_texture_webp/source").cloned();
            if let (Some(src), None) = (webp, t.get("source")) {
                t["source"] = src;
            }
        }
    }
    for key in ["extensionsRequired", "extensionsUsed"] {
        if let Some(list) = root.get_mut(key).and_then(|l| l.as_array_mut()) {
            list.retain(|e| e != "EXT_texture_webp");
        }
    }
    serde_json::to_vec(&root).map_err(|_| Error::Empty)
}

fn decode_image(
    image: &gltf::Image,
    buffers: &[gltf::buffer::Data],
) -> Result<Texture, String> {
    let bytes: &[u8] = match image.source() {
        gltf::image::Source::View { view, .. } => {
            let buf = &buffers[view.buffer().index()];
            &buf[view.offset()..view.offset() + view.length()]
        }
        gltf::image::Source::Uri { .. } => return Err("external image files are not supported".into()),
    };
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?.to_rgba8();
    Ok(Texture { width: img.width(), height: img.height(), rgba: img.into_raw() })
}

pub fn load_glb(bytes: &[u8]) -> Result<Mesh, Error> {
    let glb = gltf::Glb::from_slice(bytes)?;
    let json = patch_webp(&glb.json)?;
    let doc = gltf::Gltf::from_slice(&json)?.document;
    let buffers = gltf::import_buffers(&doc, None, glb.bin.map(|b| b.into_owned()))?;
    let mut mesh = Mesh::default();

    if doc.extensions_required().any(|e| e == "KHR_draco_mesh_compression" || e == "EXT_meshopt_compression") {
        mesh.warnings.push("compressed geometry (Draco/meshopt) is not supported; decompress the GLB first".into());
    }

    let mut texture_slot = vec![None; doc.images().len()];
    for image in doc.images() {
        match decode_image(&image, &buffers) {
            Ok(tex) => {
                texture_slot[image.index()] = Some(mesh.textures.len());
                mesh.textures.push(tex);
            }
            Err(e) => mesh.warnings.push(format!("image {}: {e}", image.index())),
        }
    }

    // Material index n is the glTF default material.
    let default_material = doc.materials().len();
    let mut tex_coord_set = Vec::new();
    for m in doc.materials() {
        let pbr = m.pbr_metallic_roughness();
        let info = pbr.base_color_texture();
        tex_coord_set.push(info.as_ref().map(|i| i.tex_coord()).unwrap_or(0));
        mesh.materials.push(Material {
            base: pbr.base_color_factor(),
            texture: info.and_then(|i| texture_slot[i.texture().source().index()]),
        });
    }
    mesh.materials.push(Material { base: [0.8, 0.8, 0.8, 1.0], texture: None });

    let scene = doc.default_scene().or_else(|| doc.scenes().next()).ok_or(Error::Empty)?;
    let identity: Mat4 = [[1., 0., 0., 0.], [0., 1., 0., 0.], [0., 0., 1., 0.], [0., 0., 0., 1.]];
    let mut stack: Vec<(gltf::Node, Mat4)> = scene.nodes().map(|n| (n, identity)).collect();

    while let Some((node, parent)) = stack.pop() {
        let world = mul(&parent, &node.transform().matrix());
        for child in node.children() {
            stack.push((child, world));
        }
        let Some(gmesh) = node.mesh() else { continue };
        for prim in gmesh.primitives() {
            if prim.mode() != gltf::mesh::Mode::Triangles {
                continue;
            }
            let reader = prim.reader(|b| Some(&buffers[b.index()]));
            let Some(positions) = reader.read_positions() else {
                mesh.warnings.push(format!("mesh '{}' has no readable positions", gmesh.name().unwrap_or("?")));
                continue;
            };
            let positions: Vec<Vec3> = positions.map(|p| transform(&world, p)).collect();
            let mat = prim.material().index().unwrap_or(default_material);
            let set = tex_coord_set.get(mat).copied().unwrap_or(0);
            let uvs: Option<Vec<[f32; 2]>> = reader.read_tex_coords(set).map(|t| t.into_f32().collect());
            let colors: Option<Vec<[f32; 3]>> = reader
                .read_colors(0)
                .map(|c| c.into_rgba_f32().map(|c| [c[0], c[1], c[2]]).collect());
            let indices: Vec<u32> = match reader.read_indices() {
                Some(i) => i.into_u32().collect(),
                None => (0..positions.len() as u32).collect(),
            };
            for tri in indices.chunks_exact(3) {
                let [a, b, c] = [tri[0] as usize, tri[1] as usize, tri[2] as usize];
                if a.max(b).max(c) >= positions.len() {
                    continue;
                }
                mesh.triangles.push(Triangle {
                    p: [positions[a], positions[b], positions[c]],
                    uv: uvs.as_ref().map(|u| [u[a], u[b], u[c]]),
                    color: colors.as_ref().map(|col| [col[a], col[b], col[c]]),
                    material: mat,
                });
            }
        }
    }

    if mesh.triangles.is_empty() {
        return Err(Error::Empty);
    }
    Ok(mesh)
}
