use crate::contract::{AppError, ErrorCode, TxtEncoding};
use encoding_rs::*;
pub fn encoding(e: TxtEncoding) -> &'static Encoding {
    match e {
        TxtEncoding::Utf16Le => UTF_16LE,
        TxtEncoding::Utf16Be => UTF_16BE,
        TxtEncoding::Gb18030 => GB18030,
        TxtEncoding::Big5 => BIG5,
        TxtEncoding::ShiftJis => SHIFT_JIS,
        TxtEncoding::EucKr => EUC_KR,
        TxtEncoding::Windows1252 => WINDOWS_1252,
        _ => UTF_8,
    }
}
fn label(e: &'static Encoding) -> TxtEncoding {
    if e == UTF_8 {
        TxtEncoding::Utf8
    } else if e == GBK || e == GB18030 {
        TxtEncoding::Gb18030
    } else if e == BIG5 {
        TxtEncoding::Big5
    } else if e == SHIFT_JIS {
        TxtEncoding::ShiftJis
    } else if e == EUC_KR {
        TxtEncoding::EucKr
    } else {
        TxtEncoding::Windows1252
    }
}
pub fn decode(
    bytes: &[u8],
    forced: TxtEncoding,
    id: &str,
) -> Result<(String, TxtEncoding), AppError> {
    let bom = Encoding::for_bom(bytes);
    let selected = if forced != TxtEncoding::Auto {
        forced
    } else if let Some((e, _)) = bom {
        if e == UTF_8 {
            TxtEncoding::Utf8
        } else if e == UTF_16LE {
            TxtEncoding::Utf16Le
        } else {
            TxtEncoding::Utf16Be
        }
    } else {
        let sample = &bytes[..bytes.len().min(8192)];
        let pairs = sample.len() / 2;
        let le = pairs > 1
            && sample
                .as_chunks::<2>()
                .0
                .iter()
                .filter(|p| p[1] == 0 && p[0] != 0)
                .count()
                * 2
                > pairs;
        let be = pairs > 1
            && sample
                .as_chunks::<2>()
                .0
                .iter()
                .filter(|p| p[0] == 0 && p[1] != 0)
                .count()
                * 2
                > pairs;
        if le {
            TxtEncoding::Utf16Le
        } else if be {
            TxtEncoding::Utf16Be
        } else if sample.contains(&0) {
            return Err(
                AppError::new(ErrorCode::TxtDecodeFailed, "Binary TXT content")
                    .with_details(serde_json::json!({"bookId": id})),
            );
        } else if std::str::from_utf8(bytes).is_ok() {
            TxtEncoding::Utf8
        } else {
            let mut d = chardetng::EncodingDetector::new();
            // Bound statistical work on large books. Skip an ASCII-only preamble,
            // and keep the detector's stream open when the sample ends mid-file.
            let start = bytes.iter().position(|b| !b.is_ascii()).unwrap_or(0);
            let end = (start + 64 * 1024).min(bytes.len());
            d.feed(&bytes[start..end], end == bytes.len());
            label(d.guess(None, true))
        }
    };
    let e = encoding(selected);
    let skip = bom.filter(|(b, _)| *b == e).map_or(0, |(_, n)| n);
    // Replace malformed/truncated sequences, never silently discard them.
    let (text, _) = e.decode_without_bom_handling(&bytes[skip..]);
    Ok((text.into_owned(), selected))
}
