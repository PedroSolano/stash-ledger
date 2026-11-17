//! Busca na trade (site oficial): search, fetch e troca em massa (exchange), como o Awakened PoE
//! Trade. A consulta é montada na interface (código do Awakened); aqui ficam a rede e os limites.
//!
//! - Anônimo: nenhum cookie é enviado (o POESESSID do modo sessão não sai para a trade).
//! - Limites lidos dos cabeçalhos X-Rate-Limit-* (limitador separado do da stash). Se a espera
//!   passar de alguns segundos, devolve um erro "tente em N s" em vez de travar a janela.
//! - A API da trade não faz parte da documentação oficial da GGG (mesmo caso do endpoint antigo
//!   da stash); ferramentas como o Awakened a usam há anos.

use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};
use serde_json::Value;
use std::time::Duration;
use tokio::sync::Mutex;

use crate::ratelimit::{now_ms, Limiter};

const BASE: &str = "https://www.pathofexile.com";
/// Espera máxima aceita antes de desistir com "tente de novo em N s".
const MAX_WAIT_MS: u64 = 4_000;

fn url(path: &[&str]) -> Result<url::Url, String> {
    let mut u = url::Url::parse(BASE).map_err(|e| e.to_string())?;
    u.path_segments_mut().map_err(|_| "bad url".to_string())?.extend(path);
    Ok(u)
}

fn valid_league(league: &str) -> Result<(), String> {
    if league.is_empty() || league.len() > 100 || league.chars().any(|c| c.is_control() || c == '/') {
        return Err("Invalid league name.".into());
    }
    Ok(())
}

/// Ids de resultado da trade: 64 caracteres hexadecimais; no máximo 10 por fetch.
pub fn valid_ids(ids: &[String]) -> bool {
    !ids.is_empty() && ids.len() <= 10 && ids.iter().all(|i| i.len() == 64 && i.chars().all(|c| c.is_ascii_hexdigit()))
}

pub fn valid_query_id(q: &str) -> bool {
    !q.is_empty() && q.len() <= 32 && q.chars().all(|c| c.is_ascii_alphanumeric())
}

async fn send(
    limiter: &Mutex<Limiter>,
    endpoint: &str,
    req: reqwest::RequestBuilder,
) -> Result<Value, String> {
    let mut lim = limiter.lock().await;
    let wait = lim.delay_for(endpoint, now_ms());
    if wait > MAX_WAIT_MS {
        return Err(format!("Trade rate limit: try again in {} s.", wait.div_ceil(1000)));
    }
    if wait > 0 {
        tokio::time::sleep(Duration::from_millis(wait)).await;
    }
    lim.record(endpoint, now_ms());
    let res = req.send().await.map_err(|e| format!("Network error talking to the trade site: {e}"))?;
    let status = res.status().as_u16();
    lim.update(endpoint, res.headers(), status, now_ms());
    drop(lim);
    let text = res.text().await.map_err(|e| format!("Network error talking to the trade site: {e}"))?;
    // A trade responde erros como {"error":{"code":..,"message":..}}: repassa para a interface.
    match serde_json::from_str::<Value>(&text) {
        Ok(v) => Ok(v),
        Err(_) if status == 429 => Err("Trade rate limit reached: wait a few seconds.".into()),
        Err(_) => Err(format!("Unexpected answer from the trade site (HTTP {status}).")),
    }
}

pub async fn search(client: &reqwest::Client, limiter: &Mutex<Limiter>, ua: &str, league: &str, body: &Value) -> Result<Value, String> {
    valid_league(league)?;
    let req = client
        .post(url(&["api", "trade", "search", league])?)
        .header(USER_AGENT, ua)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .body(body.to_string());
    send(limiter, "trade-search", req).await
}

pub async fn fetch(client: &reqwest::Client, limiter: &Mutex<Limiter>, ua: &str, ids: &[String], query: &str) -> Result<Value, String> {
    if !valid_ids(ids) || !valid_query_id(query) {
        return Err("Invalid trade result ids.".into());
    }
    let mut u = url(&["api", "trade", "fetch", &ids.join(",")])?;
    u.query_pairs_mut().append_pair("query", query);
    let req = client.get(u).header(USER_AGENT, ua).header(ACCEPT, "application/json");
    send(limiter, "trade-fetch", req).await
}

pub async fn exchange(client: &reqwest::Client, limiter: &Mutex<Limiter>, ua: &str, league: &str, body: &Value) -> Result<Value, String> {
    valid_league(league)?;
    let req = client
        .post(url(&["api", "trade", "exchange", league])?)
        .header(USER_AGENT, ua)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .body(body.to_string());
    send(limiter, "trade-exchange", req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_ids_and_league() {
        let id = "a".repeat(64);
        assert!(valid_ids(&[id.clone()]));
        assert!(!valid_ids(&[]));
        assert!(!valid_ids(&vec![id.clone(); 11]));
        assert!(!valid_ids(&["xyz".into()]));
        assert!(!valid_ids(&[format!("{}/", "a".repeat(63))]));
        assert!(valid_query_id("Ab3dE9"));
        assert!(!valid_query_id("a/b"));
        assert!(valid_league("Keepers").is_ok());
        assert!(valid_league("Hardcore Keepers").is_ok());
        assert!(valid_league("a/b").is_err());
        assert!(valid_league("").is_err());
    }

    #[test]
    fn league_is_percent_encoded_in_the_path() {
        let u = url(&["api", "trade", "search", "Hardcore Keepers"]).unwrap();
        assert_eq!(u.as_str(), "https://www.pathofexile.com/api/trade/search/Hardcore%20Keepers");
    }
}
