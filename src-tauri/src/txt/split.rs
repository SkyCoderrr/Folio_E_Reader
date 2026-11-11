use crate::{contract::*, db::invalid};
use fancy_regex::Regex;
pub struct Section {
    pub title: String,
    pub start: usize,
    pub end: usize,
    pub start_char: u64,
    pub chars: u64,
    pub heading_end: usize,
}
pub fn regex(pattern: &str, max: u32) -> Result<Regex, AppError> {
    if !(4..=100).contains(&max) {
        return Err(invalid("headingMaxChars", "Expected 4..100"));
    }
    if pattern.is_empty() || pattern.chars().count() > 1000 {
        return Err(rx_error("Regex must have 1..1000 characters"));
    }
    Regex::new(&format!("(?m:{pattern})")).map_err(|e| rx_error(&e.to_string()))
}
fn rx_error(message: &str) -> AppError {
    AppError::new(ErrorCode::TxtRegexInvalid, message)
        .with_details(serde_json::json!({"message":message,"position":null}))
}
pub fn split(text: &str, pattern: &str, max: u32, chunk: u32) -> Result<Vec<Section>, AppError> {
    let rx = regex(pattern, max)?;
    let mut headings = Vec::new();
    for (offset, line, next) in super::paragraphs::source_lines(text) {
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && trimmed.chars().count() <= max as usize
            && rx.is_match(trimmed).map_err(|e| rx_error(&e.to_string()))?
        {
            headings.push((offset, next, trimmed.to_owned()));
        }
    }
    let mut starts = Vec::new();
    if !headings.is_empty() {
        if !text[..headings[0].0].trim().is_empty() {
            starts.push((0, 0, "Preface".to_string()));
        } else {
            headings[0].0 = 0;
        }
        starts.extend(headings);
    } else {
        let mut count = 0;
        let mut index = 1;
        starts.push((0, 0, format!("Part {index}")));
        for (byte, ch) in text.char_indices() {
            let target = chunk.max(1);
            // Prefer paragraph boundaries; cap pathological unbroken paragraphs.
            let boundary = text[byte..].starts_with("\n\n")
                || text[byte..].starts_with("\r\n\r\n")
                || text[byte..].starts_with("\r\r");
            if count >= target && (boundary || count >= target.saturating_mul(2)) {
                index += 1;
                starts.push((byte, byte, format!("Part {index}")));
                count = 0;
            }
            count += ch.len_utf16() as u32;
        }
    }
    let mut global = 0;
    let mut result = Vec::with_capacity(starts.len());
    for (i, (start, heading_end, title)) in starts.iter().enumerate() {
        let end = starts.get(i + 1).map_or(text.len(), |s| s.0);
        let chars = text[*start..end].encode_utf16().count() as u64;
        result.push(Section {
            title: title.clone(),
            start: *start,
            end,
            start_char: global,
            chars,
            heading_end: *heading_end,
        });
        global += chars;
    }
    Ok(result)
}
