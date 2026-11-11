use crate::contract::TxtParagraphMode;
fn cjk(c: char) -> bool {
    matches!(c as u32, 0x2e80..=0x9fff | 0xf900..=0xfaff | 0x20000..=0x323af)
}
// Preserve source byte positions, including CRLF as two source code units.
pub(crate) fn source_lines(text: &str) -> impl Iterator<Item = (usize, &str, usize)> {
    let mut offset = 0;
    std::iter::from_fn(move || {
        if offset >= text.len() {
            return None;
        }
        let start = offset;
        let end = text[start..]
            .find(['\r', '\n'])
            .map_or(text.len(), |i| start + i);
        offset = end;
        if offset < text.len() {
            offset += if text[end..].starts_with("\r\n") {
                2
            } else {
                1
            };
        }
        Some((start, &text[start..end], offset))
    })
}
pub fn paragraphs(text: &str, mode: TxtParagraphMode) -> Vec<String> {
    let lines: Vec<&str> = source_lines(text)
        .map(|(_, s, _)| s.trim_matches([' ', '\u{3000}', '\t']))
        .collect();
    let widths: Vec<usize> = lines
        .iter()
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().count())
        .collect();
    let mut sorted = widths.clone();
    sorted.sort_unstable();
    let typical = sorted.get(sorted.len() / 2).copied().unwrap_or(0);
    let tolerance = (typical / 5).max(4);
    let wrapped = lines
        .iter()
        .filter(|s| {
            let width = s.chars().count();
            width >= 20
                && width.abs_diff(typical) <= tolerance
                && !s.ends_with(['.', '!', '?', '。', '！', '？', '：', '”', '"'])
        })
        .count();
    let join = mode == TxtParagraphMode::Blank
        || (mode == TxtParagraphMode::Auto && wrapped >= 2 && wrapped * 2 > widths.len());
    let mut out = Vec::new();
    let mut current = String::new();
    let mut blanks = 0;
    for line in lines {
        if line.is_empty() {
            if !current.is_empty() {
                out.push(std::mem::take(&mut current));
            }
            blanks += 1;
            if blanks <= 2 {
                out.push(String::new());
            }
        } else {
            blanks = 0;
            if !current.is_empty() {
                if join {
                    if !current.chars().last().is_some_and(cjk)
                        && !line.chars().next().is_some_and(cjk)
                    {
                        current.push(' ');
                    }
                } else {
                    out.push(std::mem::take(&mut current));
                }
            }
            current.push_str(line);
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}
