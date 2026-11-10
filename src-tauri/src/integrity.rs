// Целостность данных NyxLauncher.
//
// Абсолютной защиты на локальной машине не существует: у пользователя есть
// и файлы, и процесс. Реалистичная цель — tamper-evident: любое изменение
// библиотеки/сессий/ачивок руками видно, а испорченный файл уводится в
// `*.tampered.bak` вместо тихого принятия.
//
// Формат файла:
//   { "v": 1, "sig": "<hex hmac-sha256>", "data": <полезная нагрузка> }
// Подпись считается по канонической компактной сериализации `data`
// (serde_json сортирует ключи объекта), поэтому форматирование файла
// и порядок ключей на проверку не влияют.

use hmac::{Hmac, Mac};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

type HmacSha256 = Hmac<Sha256>;

const ENVELOPE_V: u64 = 1;
const SECRET_FILE: &str = "secret.bin";
const KEY_LEN: usize = 32;

pub struct Signer {
    key: Vec<u8>,
}

pub enum Loaded<T> {
    /// Файла нет — первый запуск.
    Missing,
    /// Подпись валидна.
    Signed(T),
    /// Файл старого формата (без конверта) — читаем и переподписываем.
    Legacy(T),
    /// Конверт есть, но подпись не сходится.
    Tampered(String),
}

impl Signer {
    /// Ключ живёт в `secret.bin` рядом с данными. Он не «секрет от пользователя»,
    /// а якорь целостности: без него нельзя подделать подпись, не зная ключа.
    pub fn load_or_create(dir: &Path) -> Result<Self, String> {
        let path: PathBuf = dir.join(SECRET_FILE);
        match std::fs::read(&path) {
            Ok(bytes) if bytes.len() >= KEY_LEN => Ok(Self {
                key: bytes[..KEY_LEN].to_vec(),
            }),
            _ => {
                let mut key = [0u8; KEY_LEN];
                getrandom::fill(&mut key)
                    .map_err(|e| format!("Не удалось получить случайный ключ: {}", e))?;
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
                std::fs::write(&path, key).map_err(|e| e.to_string())?;
                Ok(Self { key: key.to_vec() })
            }
        }
    }

    fn sign_bytes(&self, bytes: &[u8]) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.key).expect("HMAC принимает ключ любой длины");
        mac.update(bytes);
        hex(&mac.finalize().into_bytes())
    }

    fn verify_bytes(&self, bytes: &[u8], sig: &str) -> bool {
        let expected = self.sign_bytes(bytes);
        // Сравнение постоянного времени — привычка, хотя timing-атака здесь нерелевантна.
        if expected.len() != sig.len() {
            return false;
        }
        let mut diff = 0u8;
        for (a, b) in expected.bytes().zip(sig.bytes()) {
            diff |= a ^ b;
        }
        diff == 0
    }

    pub fn wrap<T: Serialize>(&self, value: &T) -> Result<Value, String> {
        let data = serde_json::to_value(value).map_err(|e| e.to_string())?;
        let canonical = serde_json::to_vec(&canonicalize(&data)).map_err(|e| e.to_string())?;
        Ok(json!({
            "v": ENVELOPE_V,
            "sig": self.sign_bytes(&canonical),
            "data": data,
        }))
    }

    pub fn unwrap<T: DeserializeOwned>(&self, value: &Value) -> Result<T, String> {
        let obj = value
            .as_object()
            .ok_or_else(|| "ожидался объект-конверт".to_string())?;
        let data = obj
            .get("data")
            .ok_or_else(|| "в конверте нет поля data".to_string())?;
        let sig = obj
            .get("sig")
            .and_then(Value::as_str)
            .ok_or_else(|| "в конверте нет подписи".to_string())?;
        let canonical = serde_json::to_vec(&canonicalize(data)).map_err(|e| e.to_string())?;
        if !self.verify_bytes(&canonical, sig) {
            return Err("подпись не совпадает".into());
        }
        serde_json::from_value(data.clone()).map_err(|e| e.to_string())
    }
}

/// Каноническая форма: ключи объектов отсортированы рекурсивно.
/// Так порядок ключей в файле (и включённый где-то `preserve_order`)
/// не ломает проверку подписи.
fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for k in keys {
                out.insert(k.clone(), canonicalize(&map[k]));
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(items.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

/// Читает файл: конверт → проверка подписи; старый формат → Legacy.
/// Ошибка I/O или битый JSON — Err (вызывающий делает `.bak`).
pub fn load_signed<T: DeserializeOwned>(signer: &Signer, path: &Path) -> Result<Loaded<T>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Loaded::Missing),
        Err(e) => return Err(e.to_string()),
    };
    let value: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    let is_envelope = value
        .as_object()
        .map(|o| o.contains_key("sig") && o.contains_key("data") && o.contains_key("v"))
        .unwrap_or(false);
    if is_envelope {
        return match signer.unwrap::<T>(&value) {
            Ok(v) => Ok(Loaded::Signed(v)),
            Err(reason) => Ok(Loaded::Tampered(reason)),
        };
    }
    // Миграция с v0.3: обычный JSON без подписи.
    let legacy = serde_json::from_value(value).map_err(|e| e.to_string())?;
    Ok(Loaded::Legacy(legacy))
}

pub fn save_signed<T: Serialize>(signer: &Signer, path: &Path, value: &T) -> Result<(), String> {
    let envelope = signer.wrap(value)?;
    crate::store::save_json(path, &envelope)
}

/// SHA-256 файла в hex. Для античита: exe не должен подменяться после добавления.
pub fn sha256_file(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(hex(&hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Serialize, Deserialize, PartialEq, Debug, Clone)]
    struct Doc {
        name: String,
        n: u32,
    }

    fn signer(tag: &str) -> Signer {
        let dir = std::env::temp_dir().join(format!("nyx_sign_{}_{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        Signer::load_or_create(&dir).expect("signer")
    }

    #[test]
    fn wrap_unwrap_roundtrip() {
        let s = signer("roundtrip");
        let doc = Doc {
            name: "Elden Ring".into(),
            n: 42,
        };
        let env = s.wrap(&doc).unwrap();
        let back: Doc = s.unwrap(&env).unwrap();
        assert_eq!(back, doc);
    }

    #[test]
    fn tampered_value_is_rejected() {
        let s = signer("tamper");
        let doc = Doc {
            name: "A".into(),
            n: 1,
        };
        let mut env = s.wrap(&doc).unwrap();
        env["data"]["n"] = json!(999);
        assert!(s.unwrap::<Doc>(&env).is_err());
    }

    #[test]
    fn key_survives_reload() {
        let dir = std::env::temp_dir().join(format!("nyx_sign_persist_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = Signer::load_or_create(&dir).unwrap();
        let b = Signer::load_or_create(&dir).unwrap();
        let doc = Doc {
            name: "B".into(),
            n: 7,
        };
        assert!(b.unwrap::<Doc>(&a.wrap(&doc).unwrap()).is_ok());
    }

    #[test]
    fn legacy_plain_json_is_detected() {
        let s = signer("legacy");
        let dir = std::env::temp_dir().join(format!("nyx_sign_legacy_dir_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("games.json");
        std::fs::write(&path, r#"[{"name":"Old","n":3}]"#).unwrap();
        let loaded: Loaded<Vec<Doc>> = load_signed(&s, &path).unwrap();
        match loaded {
            Loaded::Legacy(v) => assert_eq!(v[0].n, 3),
            _ => panic!("ожидался legacy"),
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn key_order_does_not_break_signature() {
        let s = signer("order");
        let doc = Doc {
            name: "C".into(),
            n: 5,
        };
        let env = s.wrap(&doc).unwrap();
        // Переставляем ключи в data: подпись должна остаться валидной.
        let mut reordered = serde_json::Map::new();
        reordered.insert("n".into(), env["data"]["n"].clone());
        reordered.insert("name".into(), env["data"]["name"].clone());
        let mut env2 = env.clone();
        env2["data"] = Value::Object(reordered);
        assert!(s.unwrap::<Doc>(&env2).is_ok());
    }

    #[test]
    fn sha256_is_stable() {
        let path = std::env::temp_dir().join(format!("nyx_hash_{}.bin", std::process::id()));
        std::fs::write(&path, b"nyx").unwrap();
        let a = sha256_file(&path).unwrap();
        let b = sha256_file(&path).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
        let _ = std::fs::remove_file(&path);
    }
}
