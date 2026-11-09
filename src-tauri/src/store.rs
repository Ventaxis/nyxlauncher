// Персистентность NyxLauncher: атомарная запись JSON + загрузка с деградацией до дефолта.

use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::path::Path;

/// Сохранение через tmp + rename, чтобы сбой не оставил битый файл.
pub fn save_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Загрузка: нет файла — Ok(None); ошибка чтения или битый JSON — Err,
/// чтобы вызывающий мог сохранить исходный файл, а не затереть его дефолтом.
pub fn load_json<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    serde_json::from_str(&text).map(Some).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Doc {
        name: String,
        n: u32,
    }

    #[test]
    fn save_then_load_roundtrip() {
        let path = std::env::temp_dir().join(format!("nyx_test_{}.json", std::process::id()));
        let doc = Doc {
            name: "Elden Ring".into(),
            n: 42,
        };
        save_json(&path, &doc).expect("save");
        let loaded: Doc = load_json(&path).expect("read").expect("load");
        assert_eq!(loaded, doc);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn load_missing_returns_none() {
        let path = std::env::temp_dir().join("nyx_test_missing_12345.json");
        let loaded: Option<Doc> = load_json(&path).expect("read");
        assert!(loaded.is_none());
    }

    #[test]
    fn load_corrupt_returns_error() {
        let path = std::env::temp_dir().join(format!("nyx_test_corrupt_{}.json", std::process::id()));
        fs::write(&path, "{ не json").unwrap();
        assert!(load_json::<Doc>(&path).is_err());
        let _ = fs::remove_file(&path);
    }
}
