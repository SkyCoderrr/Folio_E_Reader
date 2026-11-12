use crate::{
    contract::{AppError, ErrorCode},
    storage::{atomic_write, io_error, quarantine},
};
use serde_json::{Map, Value};
use std::{fs, path::PathBuf};
pub struct KvStore {
    path: PathBuf,
    values: crate::storage::SnapshotStore<Map<String, Value>>,
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
            values: crate::storage::SnapshotStore::new(values),
        })
    }
    pub fn get(&self, key: &str) -> Result<Value, AppError> {
        validate(key)?;
        Ok(self
            .values
            .snapshot()?
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
        let path = self.path.clone();
        let key = key.to_owned();
        self.values.update(move |values| {
            let mut next = values.clone();
            if value.is_null() {
                next.remove(&key);
            } else {
                next.insert(key, value);
            }
            if next != *values {
                atomic_write(&path, &Value::Object(next.clone()))?;
                *values = next;
            }
            Ok(())
        })
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

#[cfg(test)]
mod concurrency_tests {
    #[test]
    fn concurrent_writes_preserve_every_key_on_disk_and_in_snapshot() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("kv.json");
        let store = std::sync::Arc::new(super::KvStore::open(path.clone()).unwrap());
        let workers: Vec<_> = (0..8)
            .map(|i| {
                let store = store.clone();
                std::thread::spawn(move || {
                    store.set(&format!("key{i}"), serde_json::json!(i)).unwrap()
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        let saved = super::KvStore::open(path).unwrap();
        for i in 0..8 {
            assert_eq!(store.get(&format!("key{i}")).unwrap(), serde_json::json!(i));
            assert_eq!(saved.get(&format!("key{i}")).unwrap(), serde_json::json!(i));
        }
    }
}
