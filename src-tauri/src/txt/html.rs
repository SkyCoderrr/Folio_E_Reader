use crate::contract::TxtParagraphMode;
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}
pub fn render(title: &str, body: &str, lang: &str, mode: TxtParagraphMode) -> String {
    let mut out = format!(
        "<!doctype html><html lang=\"{}\"><head><meta charset=\"utf-8\"></head><body><h2>{}</h2>",
        escape(lang),
        escape(title)
    );
    for p in super::paragraphs::paragraphs(body, mode) {
        out.push_str("<p>");
        out.push_str(&escape(&p));
        out.push_str("</p>");
    }
    out.push_str("</body></html>");
    out
}
