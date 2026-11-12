use e_reader_lib::{
    contract::*,
    db::{Database, NewBook},
    profile::Profile,
    txt::{decode, html, paragraphs, split},
};
use serde_json::json;
use std::fs;
const ID: &str = "0123456789abcdef0123456789abcdef";
fn database(text: &str) -> (tempfile::TempDir, Database) {
    let temp = tempfile::tempdir().unwrap();
    let p = Profile::resolve(Some(temp.path().join("profile").into_os_string()), || {
        panic!("real profile")
    })
    .unwrap();
    let library = p.default_library(|| panic!("Documents")).unwrap();
    fs::create_dir_all(&library).unwrap();
    fs::write(library.join(format!("{ID}.txt")), text).unwrap();
    let db = Database::open(p, library);
    db.insert(&NewBook {
        id: ID.into(),
        format: "txt".into(),
        title: "TXT".into(),
        author: None,
        language: None,
        file_name: "fixture.txt".into(),
        file_size: text.len() as u64,
        cover: false,
        metadata: json!({}),
    })
    .unwrap();
    (temp, db)
}
fn settings() -> TxtSettings {
    serde_json::from_str::<Settings>(include_str!("../../contract/settings.defaults.json"))
        .unwrap()
        .txt
}
fn loc(progress: f64) -> serde_json::Value {
    json!({"sectionIndex":0,"cfi":null,"charOffset":0,"globalCharOffset":0,"progress":progress,"snippet":"中文😀"})
}
#[test]
fn utf8_and_ascii() {
    for s in ["中文😀", "ASCII\r\nnext\nlast"] {
        let (v, e) = decode::decode(s.as_bytes(), TxtEncoding::Auto, ID).unwrap();
        assert_eq!(v, s);
        assert_eq!(e, TxtEncoding::Utf8);
    }
}
#[test]
fn unicode_boms() {
    for (encoding, bom) in [
        (TxtEncoding::Utf8, vec![0xef, 0xbb, 0xbf]),
        (TxtEncoding::Utf16Le, vec![0xff, 0xfe]),
        (TxtEncoding::Utf16Be, vec![0xfe, 0xff]),
    ] {
        let s = "中文😀\r\n混合\n";
        let mut bytes = bom;
        if encoding == TxtEncoding::Utf8 {
            bytes.extend(s.as_bytes());
        } else {
            for u in s.encode_utf16() {
                bytes.extend(if encoding == TxtEncoding::Utf16Le {
                    u.to_le_bytes()
                } else {
                    u.to_be_bytes()
                });
            }
        }
        let (text, e) = decode::decode(&bytes, TxtEncoding::Auto, ID).unwrap();
        assert_eq!(text, s);
        assert_eq!(e, encoding);
    }
}
#[test]
fn chinese_legacy_detection() {
    let source = include_str!("../../tests/fixtures/xiyouji-ch1-5-utf8.txt");
    for enc in [TxtEncoding::Gb18030, TxtEncoding::Big5] {
        let (bytes, _, _) = decode::encoding(enc).encode(source);
        let (expected, _) = decode::encoding(enc).decode_without_bom_handling(&bytes);
        let (text, e) = decode::decode(&bytes, TxtEncoding::Auto, ID).unwrap();
        assert_eq!(e, enc);
        assert_eq!(text, expected);
    }
}
#[test]
fn gbk_fixture() {
    let (_, e) = decode::decode(
        include_bytes!("../../tests/fixtures/xiyouji-ch1-5-gbk.txt"),
        TxtEncoding::Auto,
        ID,
    )
    .unwrap();
    assert_eq!(e, TxtEncoding::Gb18030);
}
#[test]
fn gb18030_four_byte() {
    let s = "中文𠀀😀";
    let (b, _, bad) = encoding_rs::GB18030.encode(s);
    assert!(!bad);
    assert_eq!(decode::decode(&b, TxtEncoding::Gb18030, ID).unwrap().0, s);
}
#[test]
fn forced_legacy_encodings() {
    for (enc, s) in [
        (TxtEncoding::ShiftJis, "日本語の物語"),
        (TxtEncoding::EucKr, "한국어 이야기"),
        (TxtEncoding::Windows1252, "café €"),
    ] {
        let (b, _, bad) = decode::encoding(enc).encode(s);
        assert!(!bad);
        assert_eq!(decode::decode(&b, enc, ID).unwrap().0, s);
    }
}
#[test]
fn windows1252_detection() {
    let source = "The café’s menu costs €5. A naïve résumé. ".repeat(20);
    let (b, _, _) = encoding_rs::WINDOWS_1252.encode(&source);
    assert_eq!(
        decode::decode(&b, TxtEncoding::Auto, ID).unwrap().1,
        TxtEncoding::Windows1252
    );
}
#[test]
fn truncated_and_forced_bom() {
    assert_eq!(
        decode::decode(&[0xef, 0xbb, 0xbf, 0xe4, 0xb8], TxtEncoding::Auto, ID)
            .unwrap()
            .0,
        "�"
    );
    assert!(
        decode::decode(&[0xff, 0xfe, 0x41], TxtEncoding::Auto, ID)
            .unwrap()
            .0
            .contains('�')
    );
    assert_eq!(
        decode::decode(&[0xef, 0xbb, 0xbf, 0x41], TxtEncoding::Windows1252, ID)
            .unwrap()
            .0,
        "ï»¿A"
    );
}
#[test]
fn binary_and_bomless_utf16() {
    assert_eq!(
        decode::decode(b"binary\0data", TxtEncoding::Auto, ID)
            .unwrap_err()
            .code,
        ErrorCode::TxtDecodeFailed
    );
    assert_eq!(
        decode::decode(b"a\0b\0c\0", TxtEncoding::Auto, ID)
            .unwrap()
            .0,
        "abc"
    );
}
#[test]
fn headings_and_preface_utf16_offsets() {
    let text = "前言😀\r\n第一回 開始\r\n正文\n第１２章 全形\n内容\nChapter XII\nLatin\n楔子\n終";
    let sections = split::split(text, &settings().chapter_regex, 40, 10000).unwrap();
    assert_eq!(sections.len(), 5);
    assert_eq!(sections[0].title, "Preface");
    assert_eq!(sections[1].start_char, 6);
    let mut offset = 0;
    for s in sections {
        assert_eq!(s.start_char, offset);
        offset += s.chars;
    }
    assert_eq!(offset, text.encode_utf16().count() as u64);
}
#[test]
fn long_heading_rejected_and_fallback() {
    let s = format!("Chapter I {}\nbody", "x".repeat(60));
    let parts = split::split(&s, &settings().chapter_regex, 40, 20).unwrap();
    assert!(parts.iter().all(|s| s.title.starts_with("Part")));
    assert_eq!(
        parts.iter().map(|s| s.chars).sum::<u64>(),
        s.encode_utf16().count() as u64
    );
}
#[test]
fn invalid_regex_and_fancy_lookahead() {
    assert_eq!(
        split::regex("[", 40).unwrap_err().code,
        ErrorCode::TxtRegexInvalid
    );
    assert!(split::regex("x", 3).is_err());
    let parts = split::split(
        "Chapter I\nbody\nChapter I\nmore",
        r"^Chapter (?=I)I$",
        40,
        10000,
    )
    .unwrap();
    assert_eq!(parts[0].title, "Chapter I");
}
#[test]
fn paragraph_modes_and_cjk_join_regression() {
    let cjk = "　這是一段很長的中文文字用來測試自動換行與段落辨識\n這是另一段很長的中文文字用來測試自動換行與段落辨識\n最後一行。";
    let joined = paragraphs::paragraphs(cjk, TxtParagraphMode::Auto);
    assert_eq!(joined.len(), 1);
    assert!(!joined[0].contains(' '));
    let latin = "  This is a hard wrapped English source with several\nlines of roughly similar lengths and no terminating\npunctuation until the final line.";
    assert_eq!(
        paragraphs::paragraphs(latin, TxtParagraphMode::Auto).len(),
        1
    );
    assert!(paragraphs::paragraphs(latin, TxtParagraphMode::Auto)[0].contains("several lines"));
    assert_eq!(
        paragraphs::paragraphs(latin, TxtParagraphMode::Line).len(),
        3
    );
    assert_eq!(
        paragraphs::paragraphs("one\ntwo", TxtParagraphMode::Blank),
        vec!["one two"]
    );
    assert_eq!(
        paragraphs::paragraphs("one\n\n\n\n\ntwo", TxtParagraphMode::Line),
        vec!["one", "", "", "two"]
    );
}
#[test]
fn html_escapes_untrusted_text() {
    let html = html::render("<script>", "<&>\"'", "en", TxtParagraphMode::Line);
    assert!(!html.contains("<script>"));
    assert!(html.contains("&lt;&amp;&gt;&quot;&#39;"));
    assert!(html.contains("<meta charset=\"utf-8\">"));
}
#[test]
fn prepare_cache_prefs_metadata_and_readonly_preview() {
    let text = "前言😀\n第一回 起點\n這是書中的故事。\n第二回\n完";
    let (_t, db) = database(text);
    let st = settings();
    let count_before = db
        .with(|c| {
            Ok(c.query_row("SELECT count(*) FROM book_prefs", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap())
        })
        .unwrap();
    let preview = db.txt_preview_split(ID, &st.chapter_regex, 40).unwrap();
    assert_eq!(preview.count, 2);
    assert_eq!(
        db.with(|c| Ok(c
            .query_row("SELECT count(*) FROM book_prefs", [], |r| r
                .get::<_, i64>(0))
            .unwrap()))
            .unwrap(),
        count_before
    );
    let m = db.txt_prepare(ID, &st).unwrap();
    assert_eq!(m.lang, "zh-Hant");
    assert_eq!(m.sections.len(), 3);
    assert_eq!(m.total_chars, text.encode_utf16().count() as u64);
    let b = db.get(ID).unwrap();
    assert_eq!(b.total_chars, Some(m.total_chars));
    assert_eq!(b.language, Some("zh-Hant".into()));
    assert_eq!(
        db.txt_prefs(ID).unwrap().detected_encoding,
        Some(TxtEncoding::Utf8)
    );
    let path = &m.sections[0].path;
    let time = fs::metadata(path).unwrap().modified().unwrap();
    assert_eq!(db.txt_prepare(ID, &st).unwrap(), m);
    assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), time);
    fs::remove_file(path).unwrap();
    db.txt_prepare(ID, &st).unwrap();
    assert!(std::path::Path::new(path).exists());
    db.txt_prefs_set(ID, json!({"paragraphMode":"blank","headingMaxChars":20}))
        .unwrap();
    let changed = db.txt_prepare(ID, &st).unwrap();
    assert_ne!(changed.sections[0].path, m.sections[0].path);
    let p = db.txt_prefs_set(ID, json!({"paragraphMode":null})).unwrap();
    assert_eq!(p.paragraph_mode, None);
    assert_eq!(p.heading_max_chars, Some(20));
    assert!(
        db.txt_prefs_set(ID, json!({"headingMaxChars":101}))
            .is_err()
    );
    assert!(
        db.txt_prefs_set(ID, json!({"detectedEncoding":"utf-8"}))
            .is_err()
    );
    assert!(db.txt_prefs_set(ID, json!({"chapterRegex":"["})).is_err());
    fs::remove_file(db.get(ID).unwrap().file_path).unwrap();
    assert_eq!(
        db.txt_prepare(ID, &st).unwrap_err().code,
        ErrorCode::BookFileMissing
    );
}
#[test]
fn bookmarks_crud_validation_and_sorting() {
    let (_t, db) = database("book");
    assert!(db.bookmarks_list(ID).unwrap().is_empty());
    let later = db.bookmark_add(ID, loc(0.9), None, None).unwrap();
    let first = db
        .bookmark_add(ID, loc(0.1), Some("Chapter".into()), Some("😀".repeat(60)))
        .unwrap();
    assert_ne!(first.id, later.id);
    assert_eq!(db.bookmarks_list(ID).unwrap()[0], first);
    assert!(
        db.bookmark_add(ID, loc(0.1), None, Some("😀".repeat(61)))
            .is_err()
    );
    let mut bad = loc(0.1);
    bad.as_object_mut().unwrap().remove("cfi");
    assert!(db.bookmark_add(ID, bad, None, None).is_err());
    assert!(db.bookmark_add(ID, loc(1.1), None, None).is_err());
    assert!(db.position_get(ID).unwrap().is_none());
    assert_eq!(db.get(ID).unwrap().progress, 0.0);
    db.bookmark_remove(&first.id).unwrap();
    assert_eq!(
        db.bookmark_remove(&first.id).unwrap_err().code,
        ErrorCode::BookmarkNotFound
    );
    for id in ["0", "-1", "01", "x", "9223372036854775808"] {
        assert_eq!(
            db.bookmark_remove(id).unwrap_err().code,
            ErrorCode::InvalidArgument
        );
    }
    db.remove(&[ID.into()]).unwrap();
    assert_eq!(
        db.bookmarks_list(ID).unwrap_err().code,
        ErrorCode::BookNotFound
    );
}
#[test]
fn preview_first_twenty_and_language_guess() {
    let text = (0..30)
        .map(|i| format!("Chapter {i}\nbody\n"))
        .collect::<String>();
    let (_t, db) = database(&text);
    let p = db.txt_preview_split(ID, "^Chapter .*", 40).unwrap();
    assert_eq!(p.count, 30);
    assert_eq!(p.first20.len(), 20);
    assert_eq!(
        e_reader_lib::txt::cache::language("这是中国书本"),
        "zh-Hans"
    );
}
#[test]
#[ignore = "release performance benchmark; run with --release --ignored --nocapture"]
fn benchmark_txt_prepare_10mb() {
    let unit = "這是一段很長的中文文字用來測試自動換行與段落辨識\n這是另一段很長的中文文字用來測試自動換行與段落辨識\n最後一行。\n\n";
    let chapter = format!("第十回 測試章節\n{}", unit.repeat(500));
    let (encoded, _, _) = encoding_rs::GB18030.encode(&chapter);
    let bytes = encoded.repeat(10_000_000 / encoded.len() + 1);
    let (_t, db) = database("placeholder");
    fs::write(db.library_dir().join(format!("{ID}.txt")), &bytes).unwrap();
    db.with(|c| {
        c.execute(
            "UPDATE books SET file_size=?1 WHERE id=?2",
            rusqlite::params![bytes.len() as i64, ID],
        )
        .unwrap();
        Ok(())
    })
    .unwrap();
    let start = std::time::Instant::now();
    let manifest = db.txt_prepare(ID, &settings()).unwrap();
    let elapsed = start.elapsed();
    println!(
        "TXT prepare cold cache: {} bytes, {} sections, {:.2} ms",
        bytes.len(),
        manifest.sections.len(),
        elapsed.as_secs_f64() * 1000.0
    );
    assert!(
        elapsed.as_millis() < 400,
        "10 MB preparation exceeded 400 ms: {elapsed:?}"
    );
}
#[test]
fn cr_line_endings_and_whitespace_preface() {
    let text = "　 \r第一回 開始\r正文\r第二回 後續\r內容";
    let parts = split::split(text, &settings().chapter_regex, 40, 10000).unwrap();
    assert_eq!(parts.len(), 2);
    assert_eq!(parts[0].start_char, 0);
    assert_eq!(
        parts.iter().map(|s| s.chars).sum::<u64>(),
        text.encode_utf16().count() as u64
    );
    assert_eq!(
        paragraphs::paragraphs("one\rtwo\r\rthree", TxtParagraphMode::Blank),
        vec!["one two", "", "three"]
    );
}
#[test]
fn auto_does_not_join_irregular_widths() {
    let text = format!(
        "{}\n{}\n{}",
        "a".repeat(25),
        "b".repeat(70),
        "c".repeat(120)
    );
    assert_eq!(
        paragraphs::paragraphs(&text, TxtParagraphMode::Auto).len(),
        3
    );
}
#[test]
fn detection_after_long_ascii_preamble_and_supplementary_chinese() {
    let source = format!(
        "{}{}𠀀",
        "ASCII header ".repeat(10000),
        include_str!("../../tests/fixtures/xiyouji-ch1-5-utf8.txt")
    );
    let (bytes, _, bad) = encoding_rs::GB18030.encode(&source);
    assert!(!bad);
    let (decoded, enc) = decode::decode(&bytes, TxtEncoding::Auto, ID).unwrap();
    assert_eq!(enc, TxtEncoding::Gb18030);
    assert_eq!(decoded, source);
}
