//! Troca de nome: "Stash Ledger" → "Exile's Companion".
//!
//! - Pasta de dados: %APPDATA%\Stash Ledger é renomeada para %APPDATA%\Exile's Companion na primeira
//!   execução (histórico, configurações e cache de preços seguem junto).
//! - Instalação antiga: o instalador nomeia pasta e registro pelo nome do produto, então a
//!   atualização instala numa pasta nova e a antiga fica para trás. Na primeira execução o app roda
//!   o desinstalador antigo em modo silencioso (ele não apaga dados em modo silencioso e só fecha o
//!   executável antigo, `stash-ledger.exe`, pelo caminho dele).
//! - O identificador interno (app.stashledger.desktop) e o serviço do cofre de senhas não mudam:
//!   a sessão salva e os dados do WebView continuam valendo.
//! - O nome técnico do produto (pasta de instalação, instalador) é "Exiles Companion", sem
//!   apóstrofo: o gerador do instalador (NSIS) quebra com aspas simples no nome. O app mostra
//!   "Exile's Companion" em todo lugar.

use std::path::{Path, PathBuf};

pub const DATA_DIR: &str = "Exile's Companion";
const OLD_NAME: &str = "Stash Ledger";
/// Mesmo nome que o instalador usa nos atalhos (o productName, sem apóstrofo).
#[cfg_attr(not(windows), allow(dead_code))]
const SHORTCUT_NAME: &str = "Exiles Companion";

/// Pasta de dados, migrando a antiga se ela ainda existir.
///
/// O caminho simples é renomear a pasta. Se não der (arquivo em uso) ou se as duas já existirem
/// (migração interrompida, o app antigo ainda gravando), junta o conteúdo: históricos de snapshots
/// são combinados snapshot a snapshot, nos demais arquivos vale o mais recente, e a pasta antiga
/// fica guardada como "Stash Ledger.migrated" (nunca é apagada).
pub fn data_dir(config_dir: &Path) -> PathBuf {
    let new = config_dir.join(DATA_DIR);
    let old = config_dir.join(OLD_NAME);
    if !old.is_dir() {
        return new;
    }
    if !new.exists() && std::fs::rename(&old, &new).is_ok() {
        return new;
    }
    match merge_into(&old, &new) {
        Ok(()) => {
            let mut backup = config_dir.join(format!("{OLD_NAME}.migrated"));
            let mut n = 2;
            while backup.exists() {
                backup = config_dir.join(format!("{OLD_NAME}.migrated-{n}"));
                n += 1;
            }
            let _ = std::fs::rename(&old, &backup);
            new
        }
        // Não deu para juntar: continua usando a antiga, sem perder nada.
        Err(_) => old,
    }
}

/// Nome de armazenamento (sem .json/.json.gz) de um arquivo do store, se for um.
fn store_name(rel: &Path) -> Option<String> {
    let s = rel.to_string_lossy().replace('\\', "/");
    s.strip_suffix(".json.gz").or_else(|| s.strip_suffix(".json")).map(str::to_string)
}

fn is_history(name: &str) -> bool {
    name.starts_with("snapshots/") && name.ends_with("-history")
}

fn files(dir: &Path, base: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    for e in std::fs::read_dir(dir)? {
        let p = e?.path();
        if p.is_dir() {
            files(&p, base, out)?;
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_path_buf());
        }
    }
    Ok(())
}

fn modified(p: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Junta o histórico de snapshots das duas pastas (sem repetir, em ordem de data).
fn merge_history(old: &Path, new: &Path, name: &str) -> Result<(), String> {
    use serde_json::Value;
    let list = |dir: &Path| -> Vec<Value> {
        crate::store::read_json(dir, name).ok().flatten().and_then(|v| v.as_array().cloned()).unwrap_or_default()
    };
    let mut seen = std::collections::HashSet::new();
    let mut all: Vec<Value> = Vec::new();
    for s in list(old).into_iter().chain(list(new)) {
        let id = s.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        if !id.is_empty() && seen.insert(id) {
            all.push(s);
        }
    }
    all.sort_by_key(|s| s.get("takenAt").and_then(Value::as_u64).unwrap_or(0));
    crate::store::write_json(new, name, &Value::Array(all))
}

fn merge_into(old: &Path, new: &Path) -> Result<(), String> {
    std::fs::create_dir_all(new).map_err(|e| e.to_string())?;
    let mut rels = Vec::new();
    files(old, old, &mut rels).map_err(|e| e.to_string())?;
    let mut merged_histories = std::collections::HashSet::new();
    for rel in rels {
        let src = old.join(&rel);
        if let Some(name) = store_name(&rel) {
            if is_history(&name) {
                if merged_histories.insert(name.clone()) {
                    merge_history(old, new, &name)?;
                }
                continue;
            }
            // Mesmo dado pode estar como .json ou .json.gz: compara com o que existir na nova.
            let existing = [new.join(format!("{name}.json")), new.join(format!("{name}.json.gz"))].into_iter().find(|p| p.exists());
            match existing {
                Some(dst) if modified(&dst) >= modified(&src) => continue,
                Some(dst) => {
                    let _ = std::fs::remove_file(&dst);
                }
                None => {}
            }
        } else if new.join(&rel).exists() && modified(&new.join(&rel)) >= modified(&src) {
            continue;
        }
        let dst = new.join(&rel);
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Remove a instalação com o nome antigo, se ainda existir em outra pasta.
pub fn remove_old_install() {
    #[cfg(windows)]
    {
        let Ok(local) = std::env::var("LOCALAPPDATA") else { return };
        let old_dir = Path::new(&local).join(OLD_NAME);
        let uninstaller = old_dir.join("uninstall.exe");
        if !uninstaller.is_file() {
            return;
        }
        // Nunca desinstala a si mesmo (atualização que reaproveitou a pasta antiga).
        let me = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
        if me.map_or(true, |d| d.eq_ignore_ascii_case_path(&old_dir)) {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        std::thread::spawn(move || {
            // Dá tempo de o instalador novo terminar.
            std::thread::sleep(std::time::Duration::from_secs(5));
            // A atualização (modo update) não cria atalhos e o desinstalador antigo apaga os dele:
            // cria os novos antes (menu Iniciar sempre; área de trabalho se havia um lá).
            let q = |p: &Path| p.to_string_lossy().replace('\'', "''");
            let script = format!(
                "$ws = New-Object -ComObject WScript.Shell; $exe = '{exe}'; \
                 function Make($dir) {{ $lnk = Join-Path $dir '{name}.lnk'; if (-not (Test-Path -LiteralPath $lnk)) {{ \
                   $s = $ws.CreateShortcut($lnk); $s.TargetPath = $exe; $s.WorkingDirectory = (Split-Path $exe); $s.Save() }} }}; \
                 $programs = [Environment]::GetFolderPath('Programs'); Make $programs; \
                 $desktop = [Environment]::GetFolderPath('Desktop'); \
                 if (Test-Path -LiteralPath (Join-Path $desktop '{old}.lnk')) {{ Make $desktop }}; \
                 Start-Process -FilePath '{uninstaller}' -ArgumentList '/S' -Wait",
                exe = q(&exe),
                uninstaller = q(&uninstaller),
                name = SHORTCUT_NAME,
                old = OLD_NAME,
            );
            #[cfg(windows)]
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let _ = std::process::Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        });
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
trait PathEqIgnoreCase {
    fn eq_ignore_ascii_case_path(&self, other: &Path) -> bool;
}

impl PathEqIgnoreCase for PathBuf {
    fn eq_ignore_ascii_case_path(&self, other: &Path) -> bool {
        self.to_string_lossy().trim_end_matches(['\\', '/']).eq_ignore_ascii_case(other.to_string_lossy().trim_end_matches(['\\', '/']))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moves_the_old_data_folder() {
        let base = std::env::temp_dir().join(format!("ec-migrate-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join(OLD_NAME)).unwrap();
        std::fs::write(base.join(OLD_NAME).join("settings.json"), "{}").unwrap();
        let dir = data_dir(&base);
        assert_eq!(dir, base.join(DATA_DIR));
        assert!(dir.join("settings.json").is_file());
        assert!(!base.join(OLD_NAME).exists());
        // Segunda execução: nada muda.
        assert_eq!(data_dir(&base), base.join(DATA_DIR));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn merges_when_both_folders_exist_without_losing_history() {
        use serde_json::json;
        let base = std::env::temp_dir().join(format!("ec-merge-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let old = base.join(OLD_NAME);
        let new = base.join(DATA_DIR);
        // Antiga: histórico com 2 snapshots (comprimido) e um arquivo que só ela tem.
        let snap = |id: &str, t: u64| json!({ "id": id, "takenAt": t, "totalChaos": 1.0, "tabs": [] });
        crate::store::write_json(&old, "snapshots/covens-history", &json!([snap("a", 1), snap("b", 2)])).unwrap();
        crate::store::write_gz(&old.join("snapshots/covens-history.json.gz"), br#"[{"id":"a","takenAt":1,"totalChaos":1,"tabs":[]},{"id":"b","takenAt":2,"totalChaos":1,"tabs":[]}]"#).unwrap();
        let _ = std::fs::remove_file(old.join("snapshots/covens-history.json"));
        crate::store::write_json(&old, "snapshots/standard-latest", &json!({ "x": 1 })).unwrap();
        std::fs::write(old.join("settings.json"), r#"{"old":true}"#).unwrap();
        // Nova: um snapshot posterior e configurações mais recentes.
        std::thread::sleep(std::time::Duration::from_millis(20));
        crate::store::write_json(&new, "snapshots/covens-history", &json!([snap("c", 3), snap("b", 2)])).unwrap();
        std::fs::write(new.join("settings.json"), r#"{"new":true}"#).unwrap();

        let dir = data_dir(&base);
        assert_eq!(dir, new);
        let hist = crate::store::read_json(&new, "snapshots/covens-history").unwrap().unwrap();
        let ids: Vec<&str> = hist.as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["a", "b", "c"]);
        assert!(crate::store::read_json(&new, "snapshots/standard-latest").unwrap().is_some());
        assert_eq!(std::fs::read_to_string(new.join("settings.json")).unwrap(), r#"{"new":true}"#);
        assert!(!old.exists());
        assert!(base.join(format!("{OLD_NAME}.migrated")).join("settings.json").is_file());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn compares_paths_ignoring_case_and_trailing_slash() {
        assert!(PathBuf::from(r"C:\Users\A\AppData\Local\Stash Ledger\").eq_ignore_ascii_case_path(Path::new(r"c:\users\a\appdata\local\stash ledger")));
    }
}
