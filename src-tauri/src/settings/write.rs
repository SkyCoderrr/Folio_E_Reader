use super::{
    LoadedSettings,
    repair::{matches, schema},
};
use crate::{
    contract::{AppError, ErrorCode, Settings},
    storage::io_error,
};
use serde_json::{Value, json};
use std::path::Path;

fn issue(issues: &mut Vec<Value>, path: &str, message: &str) {
    issues.push(json!({"path":path,"message":message}));
}
fn resolve<'a>(node: &'a Value, root: &'a Value) -> &'a Value {
    node.get("$ref")
        .and_then(Value::as_str)
        .and_then(|r| root.pointer(&r[1..]))
        .unwrap_or(node)
}
fn inspect(
    value: &Value,
    node: &Value,
    root: &Value,
    path: &str,
    patch: bool,
    issues: &mut Vec<Value>,
) {
    let node = resolve(node, root);
    if patch && value.is_null() {
        return;
    }
    if let Some(obj) = value.as_object() {
        if !patch {
            for key in node["required"].as_array().into_iter().flatten() {
                let key = key.as_str().unwrap();
                if !obj.contains_key(key) {
                    issue(issues, &join(path, key), "Required key missing");
                }
            }
        }
        for (key, v) in obj {
            let at = join(path, key);
            let child = node["properties"]
                .get(key)
                .or_else(|| node.get("additionalProperties").filter(|s| s.is_object()));
            if patch && at == "version" {
                issue(issues, &at, "version cannot be patched");
                continue;
            }
            if let Some(names) = node.get("propertyNames")
                && !matches(&json!(key), names, root)
            {
                issue(issues, &at, "Unknown action");
            }
            if let Some(child) = child {
                inspect(v, child, root, &at, patch, issues);
            } else if node["additionalProperties"] == false {
                issue(issues, &at, "Unknown key");
            }
        }
    }
    if let Some(array) = value.as_array()
        && let Some(items) = node.get("items")
    {
        for (i, v) in array.iter().enumerate() {
            inspect(v, items, root, &format!("{path}[{i}]"), patch, issues);
        }
    }
    let mut shallow = node.clone();
    if let Some(obj) = shallow.as_object_mut() {
        for key in [
            "properties",
            "required",
            "additionalProperties",
            "propertyNames",
            "items",
        ] {
            obj.remove(key);
        }
    }
    if !patch && !matches(value, &shallow, root) {
        issue(issues, path, "Value does not match settings schema");
    }
}
fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.into()
    } else {
        format!("{path}.{key}")
    }
}
pub fn merge(target: &mut Value, patch: &Value, defaults: &Value) {
    if let Some(obj) = patch.as_object() {
        if !target.is_object() {
            *target = json!({});
        }
        for (key, v) in obj {
            if v.is_null() {
                if let Some(default) = defaults.get(key) {
                    target[key] = default.clone();
                } else {
                    target.as_object_mut().unwrap().remove(key);
                }
            } else {
                merge(&mut target[key], v, &defaults[key]);
            }
        }
    } else {
        *target = patch.clone();
    }
}
fn prune(value: &mut Value) {
    if let Some(obj) = value.as_object_mut() {
        for v in obj.values_mut() {
            prune(v);
        }
        obj.retain(|_, v| !v.as_object().is_some_and(|o| o.is_empty()));
    }
}
pub fn validate(value: &Value) -> Vec<Value> {
    let root = schema();
    let mut issues = vec![];
    inspect(value, &root, &root, "", false, &mut issues);
    let presets = value["presets"].as_array().cloned().unwrap_or_default();
    let mut ids = std::collections::HashSet::new();
    for (i, p) in presets.iter().enumerate() {
        if !ids.insert(p["id"].as_str().unwrap_or("")) {
            issue(
                &mut issues,
                &format!("presets[{i}].id"),
                "Duplicate preset id",
            );
        }
    }
    let active = value["activePresetId"].as_str().unwrap_or("");
    if ![
        "builtin.dark",
        "builtin.sepia",
        "builtin.light",
        "builtin.night",
    ]
    .contains(&active)
        && !ids.contains(active)
    {
        issue(&mut issues, "activePresetId", "Preset does not exist");
    }
    if let Some(regex) = value["txt"]["chapterRegex"].as_str()
        && fancy_regex::Regex::new(&format!("(?m){regex}")).is_err()
    {
        issue(
            &mut issues,
            "txt.chapterRegex",
            "Invalid regular expression",
        );
    }
    issues
}
fn invalid(issues: Vec<Value>) -> AppError {
    AppError::new(ErrorCode::SettingsInvalid, "Invalid settings")
        .with_details(json!({"issues":issues}))
}
impl LoadedSettings {
    pub fn change(
        &mut self,
        path: &Path,
        input: Value,
        patch: bool,
        test: bool,
    ) -> Result<Settings, AppError> {
        let current = serde_json::to_value(&self.effective).map_err(io_error)?;
        let mut next = input;
        if patch {
            let root = schema();
            let mut issues = vec![];
            if !next.is_object() {
                issue(&mut issues, "", "Patch must be an object");
            } else {
                inspect(&next, &root, &root, "", true, &mut issues);
            }
            if !issues.is_empty() {
                return Err(invalid(issues));
            }
            let mut defaults = serde_json::to_value(Settings::default()).map_err(io_error)?;
            if test {
                defaults["bossKey"]["enabled"] = json!(false);
            }
            let mut merged = current.clone();
            merge(&mut merged, &next, &defaults);
            prune(&mut merged["styleOverrides"]);
            next = merged;
        }
        let issues = validate(&next);
        if !issues.is_empty() {
            return Err(invalid(issues));
        }
        let keys: Vec<_> = ["/bossKey/enabled", "/bossKey/shortcut", "/library/folder"]
            .into_iter()
            .filter(|p| current.pointer(p) != next.pointer(p))
            .map(|p| p[1..].replace('/', "."))
            .collect();
        if !keys.is_empty() {
            return Err(AppError::new(
                ErrorCode::SettingsManagedKey,
                "Managed settings require their own commands",
            )
            .with_details(json!({"keys":keys})));
        }
        normalize_integers(&mut next, &schema(), &schema());
        let effective: Settings = serde_json::from_value(next).map_err(io_error)?;
        if effective != self.effective {
            let pending = LoadedSettings {
                effective,
                raw: self.raw.clone(),
                library_dir: self.library_dir.clone(),
            };
            pending.write(path)?;
            *self = pending;
        }
        Ok(self.effective.clone())
    }
}

// JSON Schema integers include numbers written as 20.0; serde integer fields do not.
fn normalize_integers(value: &mut Value, node: &Value, root: &Value) {
    let node = resolve(node, root);
    let integer = node["type"] == "integer"
        || node.get("const").is_some_and(|v| v.is_i64() || v.is_u64())
        || node["enum"]
            .as_array()
            .is_some_and(|a| !a.is_empty() && a.iter().all(|v| v.is_i64() || v.is_u64()));
    if integer && let Some(number) = value.as_f64() {
        *value = json!(number as i64);
    } else if let Some(object) = value.as_object_mut() {
        for (key, item) in object {
            if let Some(child) = node["properties"]
                .get(key)
                .or_else(|| node.get("additionalProperties").filter(|n| n.is_object()))
            {
                normalize_integers(item, child, root);
            }
        }
    } else if let Some(array) = value.as_array_mut() {
        for item in array {
            normalize_integers(item, &node["items"], root);
        }
    }
}
