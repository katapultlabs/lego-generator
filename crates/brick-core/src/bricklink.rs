//! BrickLink catalog ids for our parts and colors, and the wanted-list XML export.

use std::fmt::Write;

use crate::model::BrickModel;

/// BrickLink item number for one of our part numbers. All of ours use the same number on
/// BrickLink (checked against each catalog page, 2026-10-22).
pub fn part_id(ldraw: &str) -> Option<&'static str> {
    crate::parts::PARTS
        .iter()
        .flat_map(|p| [p.brick, p.plate])
        .chain([crate::parts::CHEESE_SLOPE])
        .find(|&n| n == ldraw)
}

/// (LDraw code, BrickLink color id). Mapping from Rebrickable's color table; every BrickLink
/// id and name checked against BrickLink's color guide (2026-10-22). LDraw 85 is LDConfig's
/// "Medium Lilac", which Rebrickable maps to BrickLink 89 "Dark Purple".
const COLORS: &[(u16, u16)] = &[
    (0, 11),
    (1, 7),
    (2, 6),
    (3, 39),
    (4, 5),
    (5, 47),
    (9, 62),
    (10, 36),
    (12, 25),
    (13, 23),
    (14, 3),
    (15, 1),
    (19, 2),
    (22, 24),
    (25, 4),
    (27, 34),
    (28, 69),
    (29, 104),
    (30, 157),
    (31, 154),
    (70, 88),
    (71, 86),
    (72, 85),
    (73, 42),
    (74, 37),
    (84, 150),
    (85, 89),
    (92, 28),
    (191, 110),
    (212, 105),
    (226, 103),
    (272, 63),
    (288, 80),
    (308, 120),
    (320, 59),
    (321, 153),
    (322, 156),
    (323, 152),
    (330, 155),
    (378, 48),
    (379, 55),
    (484, 68),
];

/// BrickLink color id for an LDraw color code.
pub fn color_id(ldraw: u16) -> Option<u16> {
    COLORS.iter().find(|c| c.0 == ldraw).map(|c| c.1)
}

/// BrickLink wanted list (Want > Upload). Lines without BrickLink ids are skipped.
pub fn wanted_list_xml(model: &BrickModel) -> String {
    let mut out = String::from("<INVENTORY>\n");
    for l in &model.bom {
        let (Some(part), Some(color)) = (&l.bricklink_part, l.bricklink_color) else {
            continue;
        };
        let _ = writeln!(
            out,
            "<ITEM><ITEMTYPE>P</ITEMTYPE><ITEMID>{part}</ITEMID><COLOR>{color}</COLOR><MINQTY>{}</MINQTY></ITEM>",
            l.count
        );
    }
    out.push_str("</INVENTORY>\n");
    out
}
