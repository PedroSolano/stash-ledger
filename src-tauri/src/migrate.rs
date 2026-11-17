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

/// Pasta de dados, migrando a antiga se for o caso. Se não der para renomear, usa a antiga.
pub fn data_dir(config_dir: &Path) -> PathBuf {
    let new = config_dir.join(DATA_DIR);
    let old = config_dir.join(OLD_NAME);
    if !new.exists() && old.is_dir() && std::fs::rename(&old, &new).is_err() {
        return old;
    }
    new
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
        std::thread::spawn(move || {
            // Dá tempo de o instalador novo terminar.
            std::thread::sleep(std::time::Duration::from_secs(5));
            let _ = std::process::Command::new(&uninstaller).arg("/S").spawn();
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
    fn compares_paths_ignoring_case_and_trailing_slash() {
        assert!(PathBuf::from(r"C:\Users\A\AppData\Local\Stash Ledger\").eq_ignore_ascii_case_path(Path::new(r"c:\users\a\appdata\local\stash ledger")));
    }
}
