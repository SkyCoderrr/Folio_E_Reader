use std::collections::{BTreeMap, BTreeSet};

const REGISTERED: &str = include_str!("../src/lib.rs");
const PERMISSIONS: &str = include_str!("../permissions/app.toml");
const CAPABILITY: &str = include_str!("../capabilities/main.json");

fn quoted(text: &str) -> impl Iterator<Item = &str> {
    text.split('"').skip(1).step_by(2)
}

fn registered_commands(source: &str) -> BTreeSet<&str> {
    let list = source
        .split_once("generate_handler![")
        .expect("registered command list")
        .1
        .split_once(']')
        .expect("end of registered command list")
        .0;
    let commands: BTreeSet<_> = list
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.strip_prefix("commands::").expect("command path"))
        .collect();
    assert!(!commands.is_empty(), "empty registered command list");
    commands
}

fn allowed_commands<'a>(permissions: &'a str, capability: &str) -> BTreeSet<&'a str> {
    let permissions: BTreeMap<_, _> = permissions
        .split("[[permission]]")
        .skip(1)
        .map(|block| {
            let identifier = block
                .lines()
                .find(|line| line.trim().starts_with("identifier ="))
                .and_then(|line| quoted(line).next())
                .expect("permission identifier");
            assert!(
                !block.contains("commands.deny"),
                "extend the ACL audit to account for command denies"
            );
            let allow = block
                .split_once("commands.allow")
                .expect("permission command allow list")
                .1
                .split_once('[')
                .expect("start of allow list")
                .1
                .split_once(']')
                .expect("end of allow list")
                .0;
            (identifier, quoted(allow).collect::<BTreeSet<_>>())
        })
        .collect();
    let capability: serde_json::Value = serde_json::from_str(capability).unwrap();
    capability["permissions"]
        .as_array()
        .expect("capability permissions")
        .iter()
        .map(|value| value.as_str().expect("permission identifier string"))
        // Plugin/core permissions have their own registries; audit application commands only.
        .filter(|identifier| !identifier.contains(':'))
        .flat_map(|identifier| {
            permissions
                .get(identifier)
                .unwrap_or_else(|| panic!("unknown application permission: {identifier}"))
                .iter()
                .copied()
        })
        .collect()
}

#[test]
fn main_capability_allows_exactly_the_registered_app_commands() {
    let registered = registered_commands(REGISTERED);
    let allowed = allowed_commands(PERMISSIONS, CAPABILITY);
    let missing: Vec<_> = registered.difference(&allowed).collect();
    let stale: Vec<_> = allowed.difference(&registered).collect();
    assert!(
        missing.is_empty() && stale.is_empty(),
        "app ACL mismatch: registered but not allowed: {missing:?}; allowed but not registered: {stale:?}"
    );
}
