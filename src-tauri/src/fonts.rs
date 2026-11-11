use crate::contract::FontFamily;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::OnceLock,
};

pub fn list() -> &'static Vec<FontFamily> {
    static FONTS: OnceLock<Vec<FontFamily>> = OnceLock::new();
    FONTS.get_or_init(scan)
}
fn scan() -> Vec<FontFamily> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut groups: BTreeMap<String, (FontFamily, BTreeSet<u32>, BTreeSet<u32>)> = BTreeMap::new();
    for info in db.faces() {
        let Some((family, names, cjk, weight, upright)) = db
            .with_face_data(info.id, |data, index| {
                let face = ttf_parser::Face::parse(data, index).ok()?;
                let all: Vec<_> = face
                    .names()
                    .into_iter()
                    .filter(|n| n.name_id == 16 || n.name_id == 1)
                    .filter_map(|n| n.to_string().map(|s| (n.name_id, n.language_id, s)))
                    .collect();
                let preferred = if all.iter().any(|n| n.0 == 16) { 16 } else { 1 };
                let family = all
                    .iter()
                    .find(|n| n.0 == 16 && n.1 == 0x0409)
                    .or_else(|| all.iter().find(|n| n.0 == 1 && n.1 == 0x0409))
                    .or_else(|| all.iter().find(|n| n.0 == preferred))?
                    .2
                    .clone();
                let localized: BTreeSet<_> = all
                    .iter()
                    .map(|n| n.2.clone())
                    .filter(|s| s != &family && !s.starts_with('@'))
                    .collect();
                let cjk = ['\u{4e00}', '\u{6c34}', '\u{3002}']
                    .into_iter()
                    .all(|c| face.glyph_index(c).is_some());
                Some((
                    family,
                    localized,
                    cjk,
                    u32::from(face.weight().to_number()),
                    !face.is_italic() && !face.is_oblique(),
                ))
            })
            .flatten()
        else {
            continue;
        };
        if family.starts_with('@') {
            continue;
        }
        let (entry, normal, italic) = groups.entry(family.to_lowercase()).or_insert_with(|| {
            (
                FontFamily {
                    family: family.clone(),
                    localized_families: vec![],
                    cjk: false,
                    weights: vec![],
                },
                BTreeSet::new(),
                BTreeSet::new(),
            )
        });
        entry.cjk |= cjk;
        entry.localized_families.extend(names);
        if upright {
            normal.insert(weight);
        } else {
            italic.insert(weight);
        }
    }
    groups
        .into_values()
        .map(|(mut font, normal, italic)| {
            font.localized_families.sort();
            font.localized_families.dedup();
            font.weights = if normal.is_empty() { italic } else { normal }
                .into_iter()
                .collect();
            font
        })
        .collect()
}
#[cfg(test)]
mod tests {
    #[test]
    fn sorted_cached_system_fonts_and_yahei() {
        let fonts = super::list();
        assert!(std::ptr::eq(fonts, super::list()));
        assert!(
            fonts
                .windows(2)
                .all(|w| w[0].family.to_lowercase() <= w[1].family.to_lowercase())
        );
        assert!(
            fonts
                .iter()
                .all(|f| !f.family.starts_with('@') && f.weights.windows(2).all(|w| w[0] < w[1]))
        );
        if let Some(font) = fonts.iter().find(|f| f.family == "Microsoft YaHei") {
            assert!(font.cjk);
            assert!(
                font.localized_families
                    .iter()
                    .any(|s| s == "\u{5fae}\u{8f6f}\u{96c5}\u{9ed1}")
            );
        } else {
            eprintln!("Microsoft YaHei absent; skipping installed-font assertion");
        }
    }
}
