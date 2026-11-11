use std::{fs::File, io::Read, path::Path};

fn author(text: &str) -> Option<String> {
    text.match_indices("作者")
        .find_map(|(index, _)| author_tail(&text[index + "作者".len()..]))
}
fn author_tail(tail: &str) -> Option<String> {
    let tail = tail.trim_start().strip_prefix([':', '：'])?.trim_start();
    let name: String = tail
        .chars()
        .take_while(|c| !c.is_whitespace() && !matches!(c, '》' | '】' | ']'))
        .take(40)
        .collect();
    (!name.is_empty()).then_some(name)
}
pub fn read(path: &Path, stem: &str) -> (String, Option<String>) {
    let mut bytes = Vec::new();
    if let Ok(file) = File::open(path) {
        let _ = file.take(4096).read_to_end(&mut bytes);
    }
    let (encoding, skip) = encoding_rs::Encoding::for_bom(&bytes).unwrap_or_else(|| {
        (
            if std::str::from_utf8(&bytes)
                .err()
                .is_none_or(|e| e.error_len().is_none())
            {
                encoding_rs::UTF_8
            } else {
                encoding_rs::GB18030
            },
            0,
        )
    });
    let (text, _, _) = encoding.decode(&bytes[skip..]);
    let writer = author(stem).or_else(|| author(&text));
    let mut title = stem
        .match_indices("作者")
        .find(|(i, _)| author_tail(&stem[*i + "作者".len()..]).is_some())
        .map(|(i, _)| &stem[..i])
        .unwrap_or(stem);
    if let Some(i) = title.to_ascii_lowercase().rfind(" by ") {
        title = &title[..i];
    }
    let title = title
        .trim()
        .trim_matches(['《', '》', '【', '】', '[', ']'])
        .trim();
    (
        if title.is_empty() {
            stem.to_owned()
        } else {
            title.to_owned()
        },
        writer,
    )
}
