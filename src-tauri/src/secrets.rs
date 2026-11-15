//! Segredos (POESESSID e tokens OAuth) no cofre do sistema: Gerenciador de Credenciais do Windows
//! (protegido por DPAPI). Nada disso vai para arquivo nem para a interface.

const SERVICE: &str = "stash-ledger";

fn entry(key: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, key).ok()
}

pub fn get(key: &str) -> Option<String> {
    entry(key)?.get_password().ok()
}

pub fn set(key: &str, value: &str) -> bool {
    entry(key).map(|e| e.set_password(value).is_ok()).unwrap_or(false)
}

pub fn delete(key: &str) {
    if let Some(e) = entry(key) {
        let _ = e.delete_credential();
    }
}

/// O cofre funciona nesta máquina? (No WSL sem chaveiro persistente, os segredos ficam na memória.)
pub fn available() -> bool {
    let ok = set("probe", "1") && get("probe").as_deref() == Some("1");
    delete("probe");
    ok
}
