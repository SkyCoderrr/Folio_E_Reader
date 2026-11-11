use super::*;

#[test]
fn text_title_preserves_incidental_author_word_and_unicode_byte_offsets() {
    let (temp, db) = database();
    let path = temp.path().join("作者的自我修养.txt");
    fs::write(&path, "作者的简介\n作者：王小明\n").unwrap();
    let b = add(&db, &path);
    assert_eq!(b.title, "作者的自我修养");
    assert_eq!(b.author.as_deref(), Some("王小明"));
    let path = temp.path().join("İstanbul by Writer.txt");
    let text = format!("作者：张三\n{}", "中".repeat(2000));
    fs::write(&path, text).unwrap();
    let b = add(&db, &path);
    assert_eq!(b.title, "İstanbul");
    assert_eq!(b.author.as_deref(), Some("张三"));
}

#[test]
fn epub2_meta_cover_and_epub3_cover_image_produce_300px_jpeg() {
    let (temp, db) = database();
    for (version, meta, manifest) in [
        (
            2,
            r#"<meta name="cover" content="c"/>"#,
            r#"<item id="c" href="cover.png"/>"#,
        ),
        (
            3,
            "",
            r#"<item id="c" href="cover.png" properties="nav cover-image"/>"#,
        ),
    ] {
        let source = temp.path().join(format!("v{version}.epub"));
        epub(
            &source,
            &format!(
                "<dc:title>Title {version} &amp; 中</dc:title><dc:title>Ignored</dc:title><dc:creator>Alice</dc:creator><dc:creator>Bob</dc:creator><dc:language>en</dc:language>{meta}"
            ),
            manifest,
            true,
            None,
        );
        let b = add(&db, &source);
        assert_eq!(b.title, format!("Title {version} & 中"));
        assert_eq!(b.author.as_deref(), Some("Alice, Bob"));
        assert_eq!(b.language.as_deref(), Some("en"));
        let cover = b.cover_path.unwrap();
        let image = image::open(&cover).unwrap();
        assert_eq!((image.width(), image.height()), (300, 450));
        assert!(fs::read(cover).unwrap().starts_with(&[0xff, 0xd8]));
        assert!(db.open_book(&b.id).unwrap().book.last_opened_at.is_some());
    }
}
#[test]
fn missing_or_broken_cover_is_nonfatal_and_title_falls_back_to_stem() {
    let (temp, db) = database();
    for cover in [false, true] {
        let path = temp.path().join(format!("fallback-{cover}.epub"));
        epub(
            &path,
            "",
            r#"<item id="c" href="missing.png" properties="cover-image"/>"#,
            cover,
            None,
        );
        let b = add(&db, &path);
        assert!(b.cover_path.is_none());
        assert!(b.title.starts_with("fallback-"));
    }
}
#[test]
fn malformed_zip_container_and_opf_fail_and_cleanup_all_owned_files() {
    let (temp, db) = database();
    let invalid = temp.path().join("invalid.epub");
    fs::write(&invalid, "not a zip").unwrap();
    let mut journal = Journal::load(&db).unwrap();
    assert_eq!(
        import::pipeline::item(&db, &mut journal, &invalid)
            .unwrap_err()
            .code,
        ErrorCode::EpubInvalid
    );
    let empty = temp.path().join("empty.epub");
    fs::write(&empty, []).unwrap();
    assert_eq!(
        import::pipeline::item(&db, &mut journal, &empty)
            .unwrap_err()
            .code,
        ErrorCode::ImportEmptyFile
    );
    let missing = temp.path().join("missing.epub");
    ZipWriter::new(File::create(&missing).unwrap())
        .finish()
        .unwrap();
    assert_eq!(
        import::pipeline::item(&db, &mut journal, &missing)
            .unwrap_err()
            .code,
        ErrorCode::EpubInvalid
    );
    assert!(db.list().unwrap().is_empty());
    assert_eq!(fs::read_dir(db.library_dir()).unwrap().count(), 0);
    assert_eq!(fs::read(&invalid).unwrap(), b"not a zip");
}
#[test]
fn duplicate_hash_restores_missing_copy_without_changing_record_metadata() {
    let (temp, db) = database();
    let source = temp.path().join("Original.TXT");
    fs::write(&source, "作者：刘慈欣\n内容").unwrap();
    let b = add(&db, &source);
    fs::remove_file(&b.file_path).unwrap();
    let renamed = temp.path().join("Renamed.txt");
    fs::copy(&source, &renamed).unwrap();
    let (outcome, duplicate) =
        import::pipeline::item(&db, &mut Journal::load(&db).unwrap(), &renamed).unwrap();
    assert_eq!(outcome, ImportOutcome::Duplicate);
    let duplicate = duplicate.unwrap();
    assert_eq!(duplicate.file_name, "Original.TXT");
    assert_eq!(duplicate.id, b.id);
    assert!(!duplicate.file_missing);
    assert_eq!(fs::read(&b.file_path).unwrap(), fs::read(&source).unwrap());
    assert_eq!(db.list().unwrap().len(), 1);
}
#[test]
fn drm_precedes_fixed_layout_and_open_revalidates_modified_copies() {
    let (temp, db) = database();
    let source = temp.path().join("restrictions.epub");
    let fixed = r#"<meta property="rendition:layout">pre-paginated</meta>"#;
    let encryption = r#"<encryption><EncryptedData><EncryptionMethod Algorithm="urn:drm"/></EncryptedData></encryption>"#;
    epub(&source, fixed, "", false, Some(encryption));
    let b = add(&db, &source);
    assert_eq!(
        db.open_book(&b.id).unwrap_err().message,
        "This book is DRM-protected and can't be opened"
    );
    assert_eq!(
        db.open_book(&b.id).unwrap_err().code,
        ErrorCode::BookDrmProtected
    );
    assert!(db.get(&b.id).unwrap().last_opened_at.is_none());
    epub(Path::new(&b.file_path), fixed, "", false, None);
    assert_eq!(
        db.open_book(&b.id).unwrap_err().message,
        "Fixed-layout books aren't supported yet"
    );
    assert_eq!(
        db.open_book(&b.id).unwrap_err().code,
        ErrorCode::BookFixedLayout
    );
    epub(Path::new(&b.file_path), "", "", false, None);
    db.open_book(&b.id).unwrap();
    fs::write(&b.file_path, "broken").unwrap();
    assert_eq!(
        db.open_book(&b.id).unwrap_err().code,
        ErrorCode::EpubInvalid
    );
}
#[test]
fn font_obfuscation_and_refined_layout_do_not_restrict_open() {
    let (temp, db) = database();
    for algorithm in [
        "http://www.idpf.org/2008/embedding",
        "http://ns.adobe.com/pdf/enc#RC",
    ] {
        let path = temp.path().join("font.epub");
        epub(
            &path,
            r##"<meta property="rendition:layout" refines="#section">pre-paginated</meta>"##,
            "",
            false,
            Some(&format!(
                r#"<encryption><EncryptedData><EncryptionMethod Algorithm="{algorithm}"/></EncryptedData></encryption>"#
            )),
        );
        let b = add(&db, &path);
        db.open_book(&b.id).unwrap();
    }
}
#[test]
fn text_metadata_cleans_title_and_sniffs_bom_utf8_and_gb18030_prefixes() {
    let (temp, db) = database();
    for (name, encoding, bom) in [
        ("《三体》 作者：刘慈欣.txt", encoding_rs::UTF_8, false),
        ("【书名】 by someone.txt", encoding_rs::GB18030, false),
        ("[UTF16].txt", encoding_rs::UTF_16LE, true),
    ] {
        let path = temp.path().join(name);
        let text = format!("作者：王小明\n{name}");
        let bytes = if bom {
            [
                vec![0xff, 0xfe],
                text.encode_utf16().flat_map(u16::to_le_bytes).collect(),
            ]
            .concat()
        } else {
            encoding.encode(&text).0.into_owned()
        };
        fs::write(&path, bytes).unwrap();
        let b = add(&db, &path);
        assert_eq!(
            b.title,
            if name.starts_with('《') {
                "三体"
            } else if name.starts_with('【') {
                "书名"
            } else {
                "UTF16"
            }
        );
        assert_eq!(
            b.author.as_deref(),
            Some(if name.starts_with('《') {
                "刘慈欣"
            } else {
                "王小明"
            })
        );
        assert!(b.language.is_none());
    }
}

fn special_epub(
    path: &Path,
    spine: &str,
    options: Option<(&str, &str)>,
    href: &str,
    cover_name: &str,
) {
    let mut writer = ZipWriter::new(File::create(path).unwrap());
    let mut entry = |name: &str, bytes: &[u8]| {
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(bytes).unwrap();
    };
    entry(
        "META-INF/container.xml",
        br#"<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>"#,
    );
    entry("OPS/book.opf", format!(r#"<package><metadata/><manifest><item id="cover" href="{href}" properties="cover-image"/></manifest><spine>{spine}</spine></package>"#).as_bytes());
    entry(cover_name, b"cover bytes");
    if let Some((name, xml)) = options {
        entry(name, xml.as_bytes());
    }
    writer.finish().unwrap();
}
#[test]
fn legacy_apple_kobo_and_any_spine_override_reject_before_open_bookkeeping() {
    for (index, options, spine) in [
        (
            0,
            Some((
                "META-INF/com.apple.ibooks.display-options.xml",
                r#"<display_options><platform><option name="fixed-layout">true</option></platform></display_options>"#,
            )),
            "",
        ),
        (
            1,
            Some((
                "META-INF/com.kobobooks.display-options.xml",
                r#"<display_options><platform><option name="fixed-layout">true</option></platform></display_options>"#,
            )),
            "",
        ),
        (
            2,
            None,
            r#"<itemref idref="first"/><itemref idref="second" properties="rendition:layout-pre-paginated"/>"#,
        ),
    ] {
        let (temp, db) = database();
        let source = temp.path().join(format!("fixed-{index}.epub"));
        special_epub(&source, spine, options, "missing.jpg", "unused");
        let book = add(&db, &source);
        assert_eq!(
            db.open_book(&book.id).unwrap_err().code,
            ErrorCode::BookFixedLayout
        );
        assert!(db.get(&book.id).unwrap().last_opened_at.is_none());
    }
}
#[test]
fn percent_encoded_cover_spaces_unicode_and_hash_are_found_but_escapes_refused() {
    for (href, name) in [
        ("Images/My%20Cover.jpg", "OPS/Images/My Cover.jpg"),
        ("Images/%E4%B8%AD.jpg", "OPS/Images/\u{4e2d}.jpg"),
        ("Images/a%23b.jpg#fragment", "OPS/Images/a#b.jpg"),
    ] {
        let (temp, _db) = database();
        let path = temp.path().join("cover.epub");
        special_epub(&path, "", None, href, name);
        assert_eq!(
            import::epub_meta::read(&path).unwrap().cover.unwrap(),
            b"cover bytes"
        );
    }
    for href in [
        "%2e%2e/%2e%2e/secret",
        "%2Fsecret",
        "https%3A//example.org/secret",
        "Images/%ZZ.jpg",
        "Images/%5csecret",
    ] {
        let (temp, _db) = database();
        let path = temp.path().join("escape.epub");
        special_epub(&path, "", None, href, "secret");
        assert!(import::epub_meta::read(&path).unwrap().cover.is_none());
    }
}
