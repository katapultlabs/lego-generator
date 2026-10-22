//! LEGO palette (LDraw codes, solid colors only) and perceptual nearest-color matching.
//!
//! RGB values follow LDraw's LDConfig.ldr closely but are not authoritative; good enough for
//! matching and previews.

/// (LDraw code, name, sRGB hex).
pub const PALETTE: &[(u16, &str, u32)] = &[
    (0, "Black", 0x1B2A34),
    (1, "Blue", 0x1E5AA8),
    (2, "Green", 0x00852B),
    (3, "Dark Turquoise", 0x069D9F),
    (4, "Red", 0xB40000),
    (5, "Dark Pink", 0xD3359D),
    (9, "Light Blue", 0x97CBD9),
    (10, "Bright Green", 0x58AB41),
    (12, "Salmon", 0xF06D61),
    (13, "Pink", 0xF6A9BB),
    (14, "Yellow", 0xFAC80A),
    (15, "White", 0xF4F4F4),
    (19, "Tan", 0xD7BA8C),
    (22, "Purple", 0x901F76),
    (25, "Orange", 0xD67923),
    (27, "Lime", 0xA5CA18),
    (28, "Dark Tan", 0x897D62),
    (29, "Bright Pink", 0xFF9ECD),
    (30, "Medium Lavender", 0xA06EB9),
    (31, "Lavender", 0xCDA4DE),
    (70, "Reddish Brown", 0x5F3109),
    (71, "Light Bluish Grey", 0xA0A5A9),
    (72, "Dark Bluish Grey", 0x6C6E68),
    (73, "Medium Blue", 0x7396C8),
    (74, "Medium Green", 0x7FC475),
    (84, "Medium Nougat", 0xAA7D55),
    (85, "Dark Purple", 0x441A91),
    (92, "Nougat", 0xBB805A),
    (191, "Bright Light Orange", 0xFCAC00),
    (212, "Bright Light Blue", 0x9DC3F7),
    (226, "Bright Light Yellow", 0xFFEC6C),
    (272, "Dark Blue", 0x19325A),
    (288, "Dark Green", 0x184632),
    (308, "Dark Brown", 0x352100),
    (320, "Dark Red", 0x720012),
    (321, "Dark Azure", 0x469BC3),
    (322, "Medium Azure", 0x68C3E2),
    (323, "Light Aqua", 0xD3F2EA),
    (330, "Olive Green", 0x77774E),
    (378, "Sand Green", 0x708E7C),
    (379, "Sand Blue", 0x70819A),
    (484, "Dark Orange", 0x91501C),
];

/// Color used for hidden interior bricks.
pub const FILLER_CODE: u16 = 71;

pub fn hex(rgb: u32) -> String {
    format!("#{rgb:06X}")
}

pub fn name_of(code: u16) -> &'static str {
    PALETTE.iter().find(|p| p.0 == code).map(|p| p.1).unwrap_or("Unknown")
}

pub fn rgb_of(code: u16) -> u32 {
    PALETTE.iter().find(|p| p.0 == code).map(|p| p.2).unwrap_or(0x808080)
}

pub type Lab = [f32; 3];

fn linear_to_xyz(c: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = c;
    [
        0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
        0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
        0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
    ]
}

/// Linear sRGB in [0,1] to CIE L*a*b* (D65).
pub fn linear_to_lab(c: [f32; 3]) -> Lab {
    let [x, y, z] = linear_to_xyz(c);
    let f = |t: f32| if t > 216.0 / 24389.0 { t.cbrt() } else { (24389.0 / 27.0 * t + 16.0) / 116.0 };
    let (fx, fy, fz) = (f(x / 0.95047), f(y), f(z / 1.08883));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

pub fn hex_to_lab(rgb: u32) -> Lab {
    let ch = |s: u32| crate::mesh::srgb_to_linear(((rgb >> s) & 0xFF) as u8);
    linear_to_lab([ch(16), ch(8), ch(0)])
}

/// CIEDE2000 color difference.
pub fn ciede2000(a: Lab, b: Lab) -> f32 {
    use std::f32::consts::PI;
    let (l1, a1, b1) = (a[0], a[1], a[2]);
    let (l2, a2, b2) = (b[0], b[1], b[2]);
    let c1 = (a1 * a1 + b1 * b1).sqrt();
    let c2 = (a2 * a2 + b2 * b2).sqrt();
    let cbar = (c1 + c2) / 2.0;
    let g = 0.5 * (1.0 - (cbar.powi(7) / (cbar.powi(7) + 25f32.powi(7))).sqrt());
    let (a1p, a2p) = ((1.0 + g) * a1, (1.0 + g) * a2);
    let (c1p, c2p) = ((a1p * a1p + b1 * b1).sqrt(), (a2p * a2p + b2 * b2).sqrt());
    let hp = |b: f32, a: f32| {
        if a == 0.0 && b == 0.0 { 0.0 } else { let h = b.atan2(a).to_degrees(); if h < 0.0 { h + 360.0 } else { h } }
    };
    let (h1p, h2p) = (hp(b1, a1p), hp(b2, a2p));
    let dlp = l2 - l1;
    let dcp = c2p - c1p;
    let mut dhp = h2p - h1p;
    if c1p * c2p != 0.0 {
        if dhp > 180.0 { dhp -= 360.0 } else if dhp < -180.0 { dhp += 360.0 }
    } else {
        dhp = 0.0;
    }
    let dhp_big = 2.0 * (c1p * c2p).sqrt() * (dhp.to_radians() / 2.0).sin();
    let lbp = (l1 + l2) / 2.0;
    let cbp = (c1p + c2p) / 2.0;
    let hbp = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) / 2.0
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) / 2.0
    } else {
        (h1p + h2p - 360.0) / 2.0
    };
    let t = 1.0 - 0.17 * (hbp - 30.0).to_radians().cos() + 0.24 * (2.0 * hbp).to_radians().cos()
        + 0.32 * (3.0 * hbp + 6.0).to_radians().cos()
        - 0.20 * (4.0 * hbp - 63.0).to_radians().cos();
    let dtheta = 30.0 * (-((hbp - 275.0) / 25.0).powi(2)).exp();
    let rc = 2.0 * (cbp.powi(7) / (cbp.powi(7) + 25f32.powi(7))).sqrt();
    let sl = 1.0 + 0.015 * (lbp - 50.0).powi(2) / (20.0 + (lbp - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * cbp;
    let sh = 1.0 + 0.015 * cbp * t;
    let rt = -(2.0 * dtheta * PI / 180.0).sin() * rc;
    let (x, y, z) = (dlp / sl, dcp / sc, dhp_big / sh);
    (x * x + y * y + z * z + rt * y * z).max(0.0).sqrt()
}

/// Precomputed palette for fast nearest-color lookups.
pub struct Matcher {
    entries: Vec<(u16, Lab)>,
}

impl Matcher {
    /// `allowed` restricts to these LDraw codes; empty means the full palette.
    pub fn new(allowed: &[u16]) -> Self {
        let entries = PALETTE
            .iter()
            .filter(|p| allowed.is_empty() || allowed.contains(&p.0))
            .map(|p| (p.0, hex_to_lab(p.2)))
            .collect();
        Self { entries }
    }

    pub fn nearest(&self, linear_rgb: [f32; 3]) -> u16 {
        self.nearest_lab(linear_to_lab(linear_rgb))
    }

    pub fn nearest_lab(&self, lab: Lab) -> u16 {
        self.entries
            .iter()
            .map(|(code, l)| (*code, ciede2000(lab, *l)))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|e| e.0)
            .unwrap_or(FILLER_CODE)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ciede2000_reference_pair() {
        // Sharma et al. test data, pair 1: expected 2.0425.
        let d = ciede2000([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485]);
        assert!((d - 2.0425).abs() < 1e-3, "{d}");
    }

    #[test]
    fn pure_colors_match_obvious_bricks() {
        let m = Matcher::new(&[]);
        assert_eq!(m.nearest([1.0, 1.0, 1.0]), 15);
        assert_eq!(m.nearest([0.0, 0.0, 0.0]), 0);
        assert_eq!(m.nearest([0.45, 0.0, 0.0]), 4);
    }
}
