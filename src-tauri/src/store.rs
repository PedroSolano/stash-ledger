//! Arquivos de dados do app (configurações, histórico, cache de preços).
//! JSON compacto; acima de 16 KB vai comprimido com gzip para ocupar o mínimo de disco.

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const GZIP_THRESHOLD: usize = 16 * 1024;

/// Nomes aceitos vindos da interface: minúsculas, dígitos, '-', '_' e '/' (sem '..' nem caminho absoluto).
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_' || c == '/')
        && !name.starts_with('/')
        && !name.ends_with('/')
        && !name.contains("//")
        && !name.contains("..")
}

fn paths(dir: &Path, name: &str) -> (PathBuf, PathBuf) {
    (dir.join(format!("{name}.json")), dir.join(format!("{name}.json.gz")))
}

pub fn read_gz(path: &Path) -> Option<Vec<u8>> {
    let file = fs::File::open(path).ok()?;
    let mut out = Vec::new();
    GzDecoder::new(file).read_to_end(&mut out).ok()?;
    Some(out)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
    }
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| format!("Could not write file: {e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("Could not save file: {e}"))
}

pub fn write_gz(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut enc = GzEncoder::new(Vec::with_capacity(bytes.len() / 6), Compression::best());
    enc.write_all(bytes).map_err(|e| e.to_string())?;
    let packed = enc.finish().map_err(|e| e.to_string())?;
    write_atomic(path, &packed)
}

pub fn read_json(dir: &Path, name: &str) -> Result<Option<Value>, String> {
    if !valid_name(name) {
        return Err("Invalid store name.".into());
    }
    let (plain, gz) = paths(dir, name);
    let bytes = if gz.exists() {
        read_gz(&gz)
    } else if plain.exists() {
        fs::read(&plain).ok()
    } else {
        None
    };
    Ok(bytes.and_then(|b| serde_json::from_slice(&b).ok()))
}

pub fn write_json(dir: &Path, name: &str, value: &Value) -> Result<(), String> {
    if !valid_name(name) {
        return Err("Invalid store name.".into());
    }
    let (plain, gz) = paths(dir, name);
    let text = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if text.len() > GZIP_THRESHOLD {
        write_gz(&gz, &text)?;
        let _ = fs::remove_file(&plain);
    } else {
        write_atomic(&plain, &text)?;
        let _ = fs::remove_file(&gz);
    }
    Ok(())
}

pub fn delete(dir: &Path, name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("Invalid store name.".into());
    }
    let (plain, gz) = paths(dir, name);
    let _ = fs::remove_file(plain);
    let _ = fs::remove_file(gz);
    Ok(())
}

/// A versão Electron (até 0.2.x) usava a mesma pasta de dados: remove o que era dela
/// (caches do Chromium, cache de preços antigo e segredos que o Tauri não consegue ler).
pub fn cleanup_legacy(dir: &Path) {
    if !dir.join("Local State").exists() {
        return;
    }
    for d in [
        "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Local Storage", "Session Storage",
        "blob_storage", "Network", "Shared Dictionary", "ShaderCache", "GrShaderCache", "GPUPersistentCache",
        "Extension State", "ninja-cache",
    ] {
        let _ = fs::remove_dir_all(dir.join(d));
    }
    for f in [
        "Local State", "Preferences", "DIPS", "DIPS-journal", "declarative_performance_observer.db",
        "declarative_performance_observer.db-journal", "auth.bin", "session.bin", ".updaterId",
    ] {
        let _ = fs::remove_file(dir.join(f));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_bad_names() {
        assert!(valid_name("settings"));
        assert!(valid_name("snapshots/covens-history"));
        assert!(!valid_name("../etc/passwd"));
        assert!(!valid_name("/abs"));
        assert!(!valid_name("Settings"));
        assert!(!valid_name("a\\b"));
        assert!(!valid_name(""));
    }

    #[test]
    fn small_plain_big_gzip() {
        let dir = std::env::temp_dir().join(format!("sl-store-{}", std::process::id()));
        write_json(&dir, "small", &json!({"a": 1})).unwrap();
        assert!(dir.join("small.json").exists());
        let big = json!({ "l": vec!["x".repeat(40); 1000] });
        write_json(&dir, "snapshots/big", &big).unwrap();
        assert!(dir.join("snapshots/big.json.gz").exists());
        assert_eq!(read_json(&dir, "snapshots/big").unwrap().unwrap(), big);
        delete(&dir, "snapshots/big").unwrap();
        assert!(read_json(&dir, "snapshots/big").unwrap().is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
