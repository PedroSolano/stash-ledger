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

const LEGACY_DIRS: [&str; 15] = [
    "Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache", "Local Storage", "Session Storage",
    "blob_storage", "Network", "Shared Dictionary", "ShaderCache", "GrShaderCache", "GPUPersistentCache",
    "Extension State", "ninja-cache",
];
const LEGACY_FILES: [&str; 9] = [
    "Local State", "Preferences", "DIPS", "DIPS-journal", "declarative_performance_observer.db",
    "declarative_performance_observer.db-journal", "auth.bin", "session.bin", ".updaterId",
];

/// Remove uma pasta inteira. No Windows o remove_dir_all às vezes falha nos caches do Chromium;
/// nesse caso apaga arquivo por arquivo.
fn remove_tree(path: &Path) -> std::io::Result<()> {
    if fs::remove_dir_all(path).is_ok() || !path.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(path)? {
        let p = entry?.path();
        if p.is_dir() {
            remove_tree(&p)?;
        } else {
            if let Ok(meta) = fs::metadata(&p) {
                let mut perm = meta.permissions();
                if perm.readonly() {
                    #[allow(clippy::permissions_set_readonly_false)]
                    perm.set_readonly(false);
                    let _ = fs::set_permissions(&p, perm);
                }
            }
            fs::remove_file(&p)?;
        }
    }
    fs::remove_dir(path)
}

/// A versão Electron (até 0.2.x) usava a mesma pasta de dados: remove o que era dela (caches do
/// Chromium, cache de preços antigo e segredos que o Tauri não consegue ler). O Tauri não cria
/// nenhum desses nomes ali (o WebView2 usa outra pasta), então é seguro checar a cada início.
pub fn cleanup_legacy(dir: &Path) {
    let mut failed = Vec::new();
    for d in LEGACY_DIRS {
        let p = dir.join(d);
        if p.exists() {
            if let Err(e) = remove_tree(&p) {
                failed.push(format!("{d}: {e}"));
            }
        }
    }
    for f in LEGACY_FILES {
        let p = dir.join(f);
        if p.exists() {
            if let Err(e) = fs::remove_file(&p) {
                failed.push(format!("{f}: {e}"));
            }
        }
    }
    if !failed.is_empty() {
        crate::logfile::append(dir, "cleanup", "Could not remove some files from the old version", Some(&serde_json::json!(failed)));
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

    #[test]
    fn cleans_electron_leftovers_but_keeps_user_data() {
        let dir = std::env::temp_dir().join(format!("sl-legacy-{}", std::process::id()));
        fs::create_dir_all(dir.join("GPUCache/sub")).unwrap();
        fs::write(dir.join("GPUCache/sub/data_0"), b"x").unwrap();
        fs::write(dir.join("Local State"), b"{}").unwrap();
        write_json(&dir, "settings", &json!({"league": "Covens"})).unwrap();
        write_json(&dir, "snapshots/covens-history", &json!([1])).unwrap();
        cleanup_legacy(&dir);
        assert!(!dir.join("GPUCache").exists());
        assert!(!dir.join("Local State").exists());
        assert!(read_json(&dir, "settings").unwrap().is_some());
        assert!(read_json(&dir, "snapshots/covens-history").unwrap().is_some());
        let _ = fs::remove_dir_all(dir);
    }
}
