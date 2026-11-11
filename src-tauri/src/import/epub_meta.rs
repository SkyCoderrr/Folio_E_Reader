use crate::contract::{AppError, ErrorCode};
use quick_xml::{Reader, events::Event};
use std::{collections::BTreeMap, fs::File, io::Read, path::Path};
use zip::ZipArchive;

#[derive(Default, Debug)]
pub struct Metadata {
    pub title: Option<String>,
    pub author: Option<String>,
    pub language: Option<String>,
    pub cover: Option<Vec<u8>>,
    pub drm: bool,
    pub fixed: bool,
}
#[derive(Default)]
struct Node {
    name: String,
    attributes: BTreeMap<String, String>,
    text: String,
    parent: Option<usize>,
}
pub fn invalid(reason: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorCode::EpubInvalid, reason.to_string())
        .with_details(serde_json::json!({"reason":reason.to_string()}))
}
fn nodes(xml: &[u8]) -> Result<Vec<Node>, AppError> {
    let mut reader = Reader::from_reader(xml);
    let mut nodes: Vec<Node> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    loop {
        let event = reader.read_event().map_err(invalid)?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                if stack.len() > 128 || nodes.len() > 100_000 {
                    return Err(invalid("XML complexity limit"));
                }
                let mut attributes = BTreeMap::new();
                for a in e.attributes() {
                    let a = a.map_err(invalid)?;
                    attributes.insert(
                        String::from_utf8_lossy(a.key.as_ref()).into_owned(),
                        a.decode_and_unescape_value(reader.decoder())
                            .map_err(invalid)?
                            .into_owned(),
                    );
                }
                nodes.push(Node {
                    name: String::from_utf8_lossy(e.local_name().as_ref()).into_owned(),
                    attributes,
                    parent: stack.last().copied(),
                    text: String::new(),
                });
                if !empty {
                    stack.push(nodes.len() - 1);
                }
            }
            Event::End(_) => {
                stack.pop().ok_or_else(|| invalid("Unbalanced XML"))?;
            }
            Event::Text(t) => {
                let text = t.xml_content().map_err(invalid)?;
                let text = quick_xml::escape::unescape(&text).map_err(invalid)?;
                for i in &stack {
                    nodes[*i].text.push_str(&text);
                }
            }
            Event::CData(t) => {
                let text = t.xml_content().map_err(invalid)?;
                for i in &stack {
                    nodes[*i].text.push_str(&text);
                }
            }
            Event::GeneralRef(r) => {
                let name = r.decode().map_err(invalid)?;
                let entity = format!("&{name};");
                let text = quick_xml::escape::unescape(&entity).map_err(invalid)?;
                for i in &stack {
                    nodes[*i].text.push_str(&text);
                }
            }
            Event::DocType(_) => return Err(invalid("DTDs are not supported")),
            Event::Eof => break,
            _ => {}
        }
    }
    if !stack.is_empty() || nodes.is_empty() {
        return Err(invalid("Incomplete XML"));
    }
    Ok(nodes)
}
fn member(zip: &mut ZipArchive<File>, name: &str, limit: u64) -> Result<Vec<u8>, AppError> {
    let file = zip.by_name(name).map_err(invalid)?;
    if file.size() > limit {
        return Err(invalid("ZIP member exceeds size limit"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(invalid)?;
    if bytes.len() as u64 > limit {
        return Err(invalid("ZIP expansion limit"));
    }
    Ok(bytes)
}
fn attr<'a>(node: &'a Node, key: &str) -> &'a str {
    node.attributes.get(key).map(String::as_str).unwrap_or("")
}
fn resource(base: &str, href: &str) -> Option<String> {
    let raw = href.split('#').next()?.split('?').next()?;
    let mut bytes = Vec::with_capacity(raw.len());
    let mut input = raw.as_bytes().iter().copied();
    while let Some(byte) = input.next() {
        bytes.push(if byte == b'%' {
            let hi = (input.next()? as char).to_digit(16)?;
            let lo = (input.next()? as char).to_digit(16)?;
            (hi * 16 + lo) as u8
        } else {
            byte
        });
    }
    let href = String::from_utf8(bytes).ok()?;
    if href.contains([':', '\\', '\0']) || href.starts_with('/') {
        return None;
    }
    let mut parts: Vec<&str> = base
        .rsplit_once('/')
        .map(|(p, _)| p.split('/').collect())
        .unwrap_or_default();
    for part in href.split('/') {
        match part {
            "." | "" => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}
pub fn read(path: &Path) -> Result<Metadata, AppError> {
    let mut zip = ZipArchive::new(File::open(path).map_err(invalid)?).map_err(invalid)?;
    if zip.len() > 10_000 {
        return Err(invalid("Too many ZIP members"));
    }
    let mut expanded = 0u64;
    for i in 0..zip.len() {
        expanded = expanded
            .checked_add(zip.by_index(i).map_err(invalid)?.size())
            .ok_or_else(|| invalid("ZIP size overflow"))?;
        if expanded > 1_073_741_824 {
            return Err(invalid("ZIP total expansion limit"));
        }
    }
    let container = nodes(&member(
        &mut zip,
        "META-INF/container.xml",
        4 * 1024 * 1024,
    )?)?;
    let opf_path = container
        .iter()
        .find(|n| n.name == "rootfile")
        .map(|n| attr(n, "full-path"))
        .filter(|p| !p.is_empty())
        .ok_or_else(|| invalid("Missing OPF rootfile"))?;
    let opf = nodes(&member(&mut zip, opf_path, 4 * 1024 * 1024)?)?;
    if !opf.iter().any(|n| n.name == "package") {
        return Err(invalid("Missing OPF package"));
    }
    let in_metadata = |n: &&Node| n.parent.is_some_and(|i| opf[i].name == "metadata");
    let first = |name: &str| {
        opf.iter()
            .filter(in_metadata)
            .find(|n| n.name == name && !n.text.trim().is_empty())
            .map(|n| n.text.trim().to_owned())
    };
    let creators: Vec<_> = opf
        .iter()
        .filter(in_metadata)
        .filter(|n| n.name == "creator" && !n.text.trim().is_empty())
        .map(|n| n.text.trim())
        .collect();
    let mut meta = Metadata {
        title: first("title"),
        author: (!creators.is_empty()).then(|| creators.join(", ")),
        language: first("language"),
        ..Default::default()
    };
    meta.fixed = opf.iter().filter(in_metadata).any(|n| {
        n.name == "meta"
            && attr(n, "property") == "rendition:layout"
            && attr(n, "refines").is_empty()
            && n.text.trim() == "pre-paginated"
    });
    meta.fixed |= opf.iter().any(|n| {
        n.name == "itemref"
            && n.parent.is_some_and(|i| opf[i].name == "spine")
            && attr(n, "properties")
                .split_whitespace()
                .any(|p| p == "rendition:layout-pre-paginated")
    });
    for name in [
        "META-INF/com.apple.ibooks.display-options.xml",
        "META-INF/com.kobobooks.display-options.xml",
    ] {
        if zip.file_names().any(|n| n == name) {
            let options = nodes(&member(&mut zip, name, 4 * 1024 * 1024)?)?;
            meta.fixed |= options.iter().any(|n| {
                n.name == "option"
                    && attr(n, "name") == "fixed-layout"
                    && n.text.trim().eq_ignore_ascii_case("true")
            });
        }
    }
    let cover_id = opf
        .iter()
        .find(|n| n.name == "meta" && attr(n, "name") == "cover")
        .map(|n| attr(n, "content"));
    let manifest: Vec<_> = opf
        .iter()
        .filter(|n| n.name == "item" && n.parent.is_some_and(|i| opf[i].name == "manifest"))
        .collect();
    let cover = manifest
        .iter()
        .find(|n| {
            attr(n, "properties")
                .split_whitespace()
                .any(|p| p == "cover-image")
        })
        .or_else(|| manifest.iter().find(|n| cover_id == Some(attr(n, "id"))));
    if let Some(name) = cover.and_then(|n| resource(opf_path, attr(n, "href"))) {
        meta.cover = member(&mut zip, &name, 16 * 1024 * 1024).ok();
    }
    if zip.file_names().any(|n| n == "META-INF/encryption.xml") {
        let encryption = nodes(&member(
            &mut zip,
            "META-INF/encryption.xml",
            4 * 1024 * 1024,
        )?)?;
        meta.drm = encryption.iter().any(|n| {
            n.name == "EncryptionMethod"
                && !matches!(
                    attr(n, "Algorithm"),
                    "http://www.idpf.org/2008/embedding" | "http://ns.adobe.com/pdf/enc#RC"
                )
        });
        // An encrypted resource without a declared method cannot be assumed safe.
        if encryption.iter().any(|n| n.name == "EncryptedData")
            && !encryption.iter().any(|n| n.name == "EncryptionMethod")
        {
            meta.drm = true;
        }
    }
    Ok(meta)
}
