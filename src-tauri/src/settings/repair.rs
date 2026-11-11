use serde_json::{Map, Value, json};
pub(super) fn schema() -> Value {
    serde_json::from_str(include_str!("../../../contract/settings.schema.json"))
        .expect("contract schema")
}
fn equal(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(a), Some(b)) => a == b,
        _ => a == b,
    }
}
fn deref<'a>(node: &'a Value, root: &'a Value) -> &'a Value {
    node.get("$ref")
        .and_then(Value::as_str)
        .and_then(|r| root.pointer(&r[1..]))
        .unwrap_or(node)
}
pub(super) fn matches(value: &Value, node: &Value, root: &Value) -> bool {
    let node = deref(node, root);
    if let Some(c) = node.get("const")
        && !equal(value, c)
    {
        return false;
    }
    if let Some(values) = node.get("enum").and_then(Value::as_array)
        && !values.iter().any(|candidate| equal(candidate, value))
    {
        return false;
    }
    if let Some(list) = node.get("allOf").and_then(Value::as_array)
        && !list.iter().all(|s| matches(value, s, root))
    {
        return false;
    }
    if let Some(list) = node.get("anyOf").and_then(Value::as_array)
        && !list.iter().any(|s| matches(value, s, root))
    {
        return false;
    }
    if let Some(kind) = node.get("type").and_then(Value::as_str) {
        let valid = match kind {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "number" => value.is_number(),
            "integer" => value.as_f64().is_some_and(|v| v.fract() == 0.0),
            "boolean" => value.is_boolean(),
            "null" => value.is_null(),
            _ => false,
        };
        if !valid {
            return false;
        }
    }
    if let Some(n) = value.as_f64()
        && (node
            .get("minimum")
            .and_then(Value::as_f64)
            .is_some_and(|b| n < b)
            || node
                .get("maximum")
                .and_then(Value::as_f64)
                .is_some_and(|b| n > b))
    {
        return false;
    }
    if let Some(s) = value.as_str() {
        let len = s.chars().count() as u64;
        if node
            .get("minLength")
            .and_then(Value::as_u64)
            .is_some_and(|b| len < b)
            || node
                .get("maxLength")
                .and_then(Value::as_u64)
                .is_some_and(|b| len > b)
        {
            return false;
        }
        if let Some(pattern) = node.get("pattern").and_then(Value::as_str)
            && !fancy_regex::Regex::new(pattern).is_ok_and(|r| r.is_match(s).unwrap_or(false))
        {
            return false;
        }
    }
    if let Some(object) = value.as_object() {
        if let Some(required) = node.get("required").and_then(Value::as_array)
            && required
                .iter()
                .any(|k| !object.contains_key(k.as_str().unwrap()))
        {
            return false;
        }
        for (key, item) in object {
            if let Some(property) = node.get("properties").and_then(|p| p.get(key)) {
                if !matches(item, property, root) {
                    return false;
                }
            } else if node.get("additionalProperties") == Some(&Value::Bool(false)) {
                return false;
            } else if let Some(additional) =
                node.get("additionalProperties").filter(|v| v.is_object())
                && !matches(item, additional, root)
            {
                return false;
            }
            if let Some(names) = node.get("propertyNames")
                && !matches(&Value::String(key.clone()), names, root)
            {
                return false;
            }
        }
    }
    if let Some(array) = value.as_array() {
        if node
            .get("maxItems")
            .and_then(Value::as_u64)
            .is_some_and(|b| array.len() as u64 > b)
        {
            return false;
        }
        if node.get("uniqueItems") == Some(&Value::Bool(true))
            && array
                .iter()
                .enumerate()
                .any(|(i, v)| array[..i].contains(v))
        {
            return false;
        }
        if let Some(items) = node.get("items")
            && !array.iter().all(|v| matches(v, items, root))
        {
            return false;
        }
    }
    true
}
pub(super) fn repair(
    value: &Value,
    node: &Value,
    fallback: &Value,
    root: &Value,
    path: &str,
) -> Value {
    let node = deref(node, root);
    if let Some(properties) = node.get("properties").and_then(Value::as_object) {
        let empty = Map::new();
        let input = value.as_object().unwrap_or(&empty);
        let required = node.get("required").and_then(Value::as_array);
        let mut output = Map::new();
        for (key, property) in properties {
            if let Some(v) = input.get(key) {
                let default = fallback
                    .get(key)
                    .or_else(|| deref(property, root).get("default"))
                    .unwrap_or(&Value::Null);
                let fixed = repair(v, property, default, root, &format!("{path}.{key}"));
                if !fixed.is_null() || matches(&fixed, property, root) {
                    output.insert(key.clone(), fixed);
                }
            } else if let Some(v) = fallback.get(key) {
                output.insert(key.clone(), v.clone());
            } else if required.is_some_and(|r| r.contains(&Value::String(key.clone())))
                && let Some(default) = deref(property, root).get("default")
            {
                output.insert(key.clone(), default.clone());
            }
        }
        if required.is_none() {
            output.retain(|_, v| !v.as_object().is_some_and(Map::is_empty));
        }
        let result = Value::Object(output);
        // Sparse override objects may be empty; complete settings groups may not.
        return result;
    }
    let mut candidate = value.clone();
    if let (Some(n), Some(values)) = (value.as_f64(), node.get("enum").and_then(Value::as_array))
        && values.iter().all(Value::is_number)
    {
        let min = values
            .iter()
            .filter_map(Value::as_f64)
            .fold(f64::INFINITY, f64::min);
        let max = values
            .iter()
            .filter_map(Value::as_f64)
            .fold(f64::NEG_INFINITY, f64::max);
        candidate = json!(n.round().clamp(min, max) as i64);
    }
    if let Some(n) = value.as_f64().filter(|_| node.get("type").is_some()) {
        let mut n = if node.get("type").and_then(Value::as_str) == Some("integer") {
            n.round()
        } else {
            n
        };
        let range = node
            .get("anyOf")
            .and_then(Value::as_array)
            .and_then(|a| a.iter().find(|s| s.get("minimum").is_some()))
            .unwrap_or(node);
        if range != node && n <= 0.0 {
            n = 0.0;
        } else {
            if let Some(min) = range.get("minimum").and_then(Value::as_f64) {
                n = n.max(min);
            }
            if let Some(max) = range.get("maximum").and_then(Value::as_f64) {
                n = n.min(max);
            }
        }
        candidate = if node.get("type").and_then(Value::as_str) == Some("integer") {
            json!(n as i64)
        } else {
            json!(n)
        };
    }
    if !matches(&candidate, node, root) {
        candidate = fallback.clone();
    }
    if candidate != *value {
        log::warn!("settings repair: {path}");
    }
    candidate
}
