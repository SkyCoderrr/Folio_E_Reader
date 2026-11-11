use crate::{
    contract::{AppError, ErrorCode},
    storage::{atomic_write, io_error, quarantine},
};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf, sync::Mutex};
pub struct KvStore {
    path: PathBuf,
    values: Mutex<Map<String, Value>>,
}
impl KvStore {
    pub fn open(path: PathBuf) -> Result<Self, AppError> {
        let values = match fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Map<String, Value>>(&bytes) {
                Ok(values) => values,
                Err(_) => {
                    quarantine(&path)?;
                    Map::new()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Map::new(),
            Err(e) => return Err(io_error(e)),
        };
        Ok(Self {
            path,
            values: Mutex::new(values),
        })
    }
    pub fn get(&self, key: &str) -> Result<Value, AppError> {
        validate(key)?;
        Ok(self
            .values
            .lock()
            .map_err(io_error)?
            .get(key)
            .cloned()
            .unwrap_or(Value::Null))
    }
    pub fn set(&self, key: &str, value: Value) -> Result<(), AppError> {
        validate(key)?;
        if serde_json::to_vec(&value).map_err(io_error)?.len() > 65536 {
            return Err(
                AppError::new(ErrorCode::InvalidArgument, "KV value exceeds 64 KiB").with_details(
                    serde_json::json!({"field":"value","reason":"Serialized value exceeds 64 KiB"}),
                ),
            );
        }
        let mut values = self.values.lock().map_err(io_error)?;
        let mut next = values.clone();
        if value.is_null() {
            next.remove(key);
        } else {
            next.insert(key.into(), value);
        }
        if next != *values {
            atomic_write(&self.path, &Value::Object(next.clone()))?;
            *values = next;
        }
        Ok(())
    }
}
fn validate(key: &str) -> Result<(), AppError> {
    if key.is_empty()
        || key.len() > 128
        || !key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._:-".contains(&c))
    {
        return Err(
            AppError::new(ErrorCode::InvalidArgument, "Invalid KV key").with_details(
                serde_json::json!({"field":"key","reason":"Expected [A-Za-z0-9._:-]{1,128}"}),
            ),
        );
    }
    Ok(())
}
