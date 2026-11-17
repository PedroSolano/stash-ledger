//! Log de erros em texto simples (exiles-companion.log na pasta de dados). Nunca recebe cookies nem tokens.

use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BYTES: u64 = 1_000_000;
pub const FILE: &str = "exiles-companion.log";

/// Data UTC no formato ISO 8601, sem dependências extras.
pub fn iso_now() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Algoritmo civil_from_days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

pub fn append(dir: &Path, context: &str, message: &str, extra: Option<&Value>) {
    let path = dir.join(FILE);
    if fs::metadata(&path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
        let _ = fs::rename(&path, dir.join(format!("{FILE}.old")));
    }
    let mut line = format!("{} [{}] {}\n", iso_now(), context, message.replace('\n', " "));
    if let Some(x) = extra {
        let s: String = x.to_string().chars().take(2000).collect();
        line.push_str("  ");
        line.push_str(&s);
        line.push('\n');
    }
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}
