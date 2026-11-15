//! Leitura da stash: endpoint antigo do site (POESESSID) e API oficial (OAuth).
//! Todas as requisições à GGG passam pelo limitador e rodam em série.

use crate::ratelimit::{now_ms, Limiter};
use reqwest::header::{ACCEPT, AUTHORIZATION, COOKIE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use url::Url;

const LEGACY_ENDPOINT: &str = "https://www.pathofexile.com/character-window/get-stash-items";
const API: &str = "https://api.pathofexile.com";

#[derive(Debug)]
pub enum GggError {
    /// POESESSID recusado/expirado: o chamador apaga a sessão para não insistir (4xx contam contra o IP).
    SessionInvalid,
    /// Token OAuth ausente/expirado sem como renovar.
    NotLoggedIn,
    Other(String),
}

impl GggError {
    pub fn message(&self) -> String {
        match self {
            GggError::SessionInvalid => "GGG rejected the session. Check your POESESSID (it expires when you sign out of the website) and your account name including the #1234.".into(),
            GggError::NotLoggedIn => "Your session expired. Please sign in again.".into(),
            GggError::Other(m) => m.clone(),
        }
    }
}

impl From<String> for GggError {
    fn from(s: String) -> Self {
        GggError::Other(s)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyCreds {
    pub poesessid: String,
    pub account_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_name: Option<String>,
}

/// POESESSID: 32 caracteres hexadecimais (também impede injeção de cabeçalho).
pub fn normalize_poesessid(raw: &str) -> Result<String, String> {
    let v = raw.trim();
    if v.len() == 32 && v.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(v.to_ascii_lowercase())
    } else {
        Err("Invalid POESESSID: it must be 32 hexadecimal characters.".into())
    }
}

/// Nome da conta como no site, com o discriminador opcional #1234.
pub fn normalize_account_name(raw: &str) -> Result<String, String> {
    let v = raw.trim();
    let bad = || Err("Invalid account name. Use the format shown on the website, e.g. YourName#1234.".to_string());
    if v.chars().any(|c| c.is_control()) || v.starts_with('#') {
        return bad();
    }
    let (name, tag) = match v.split_once('#') {
        Some((n, t)) => (n, Some(t)),
        None => (v, None),
    };
    if name.chars().count() < 2 || name.chars().count() > 40 {
        return bad();
    }
    if let Some(t) = tag {
        if t.len() != 4 || !t.chars().all(|c| c.is_ascii_digit()) {
            return bad();
        }
    }
    Ok(v.to_string())
}

pub fn is_stash_id(id: &str) -> bool {
    id.len() == 10 && id.chars().all(|c| c.is_ascii_hexdigit())
}

fn hex_colour(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        return Some(s.trim_start_matches('#').to_string());
    }
    let c = |k: &str| v.get(k).and_then(Value::as_f64).map(|x| x.clamp(0.0, 255.0) as u8);
    Some(format!("{:02x}{:02x}{:02x}", c("r")?, c("g")?, c("b")?))
}

/// Lista de abas do endpoint antigo; `index` é o tabIndex usado nas requisições.
pub fn flatten_legacy_tabs(tabs: &[Value]) -> Vec<TabInfo> {
    let mut sorted: Vec<&Value> = tabs.iter().collect();
    sorted.sort_by_key(|t| t.get("i").and_then(Value::as_u64).unwrap_or(0));
    let mut out = Vec::new();
    for t in sorted {
        let s = |k: &str| t.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let children = t.get("children").and_then(Value::as_array);
        if let Some(children) = children.filter(|c| !c.is_empty()) {
            for c in children {
                let cs = |k: &str| c.get(k).and_then(Value::as_str).unwrap_or("").to_string();
                out.push(TabInfo {
                    id: cs("id"),
                    name: cs("n"),
                    kind: cs("type"),
                    index: c.get("i").and_then(Value::as_u64).unwrap_or(0) as u32,
                    colour: c.get("colour").and_then(hex_colour),
                    parent_id: Some(s("id")),
                    parent_name: Some(s("n")),
                });
            }
            continue;
        }
        if s("type") == "Folder" {
            continue;
        }
        out.push(TabInfo {
            id: s("id"),
            name: s("n"),
            kind: s("type"),
            index: t.get("i").and_then(Value::as_u64).unwrap_or(0) as u32,
            colour: t.get("colour").and_then(hex_colour),
            parent_id: None,
            parent_name: None,
        });
    }
    out
}

/// Lista de abas da API oficial: pastas viram suas abas internas; abas com sub-abas ficam como uma.
pub fn flatten_api_tabs(stashes: &[Value]) -> Vec<TabInfo> {
    let mut sorted: Vec<&Value> = stashes.iter().collect();
    sorted.sort_by_key(|t| t.get("index").and_then(Value::as_u64).unwrap_or(0));
    let mut out: Vec<TabInfo> = Vec::new();
    for s in sorted {
        let str_of = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        let colour = |v: &Value| v.get("metadata").and_then(|m| m.get("colour")).and_then(hex_colour);
        let folder = str_of(s, "type") == "Folder" || s.get("metadata").and_then(|m| m.get("folder")).and_then(Value::as_bool) == Some(true);
        if folder {
            let mut children: Vec<&Value> = s.get("children").and_then(Value::as_array).map(|c| c.iter().collect()).unwrap_or_default();
            children.sort_by_key(|t| t.get("index").and_then(Value::as_u64).unwrap_or(0));
            for c in children {
                let index = out.len() as u32;
                out.push(TabInfo {
                    id: str_of(c, "id"),
                    name: str_of(c, "name"),
                    kind: str_of(c, "type"),
                    index,
                    colour: colour(c),
                    parent_id: Some(str_of(s, "id")),
                    parent_name: Some(str_of(s, "name")),
                });
            }
            continue;
        }
        let index = out.len() as u32;
        out.push(TabInfo { id: str_of(s, "id"), name: str_of(s, "name"), kind: str_of(s, "type"), index, colour: colour(s), parent_id: None, parent_name: None });
    }
    out
}

/// Envia uma requisição respeitando os limites. O lock serializa todas as chamadas à GGG.
pub async fn send_limited(
    limiter: &Mutex<Limiter>,
    app: &AppHandle,
    endpoint: &str,
    req: reqwest::RequestBuilder,
) -> Result<reqwest::Response, GggError> {
    let mut lim = limiter.lock().await;
    let wait = lim.delay_for(endpoint, now_ms());
    if wait > 0 {
        let _ = app.emit("progress", json!({ "kind": "ratelimit", "waitMs": wait }));
        tokio::time::sleep(Duration::from_millis(wait)).await;
    }
    lim.record(endpoint, now_ms());
    let res = req.send().await.map_err(|e| GggError::Other(format!("Network error talking to GGG: {e}")))?;
    lim.update(endpoint, res.headers(), res.status().as_u16(), now_ms());
    Ok(res)
}

/// Uma requisição ao endpoint antigo do site.
pub async fn legacy_request(
    client: &reqwest::Client,
    limiter: &Mutex<Limiter>,
    app: &AppHandle,
    user_agent: &str,
    creds: &LegacyCreds,
    league: &str,
    tab_index: u32,
    with_tabs: bool,
) -> Result<Value, GggError> {
    let mut url = Url::parse(LEGACY_ENDPOINT).expect("URL fixa");
    url.query_pairs_mut()
        .append_pair("league", league)
        .append_pair("realm", "pc")
        .append_pair("accountName", &creds.account_name)
        .append_pair("tabs", if with_tabs { "1" } else { "0" })
        .append_pair("tabIndex", &tab_index.to_string());
    let cookie = format!("POESESSID={}", normalize_poesessid(&creds.poesessid)?);
    for attempt in 0..2 {
        let req = client.get(url.clone()).header(COOKIE, &cookie).header(USER_AGENT, user_agent).header(ACCEPT, "application/json");
        let res = send_limited(limiter, app, "legacy-stash", req).await?;
        let status = res.status().as_u16();
        if status == 429 && attempt == 0 {
            continue;
        }
        // Sem sessão o site responde 403 com HTML (ou redireciona para o login).
        if status == 401 || status == 403 || (300..400).contains(&status) {
            return Err(GggError::SessionInvalid);
        }
        let is_json = res.headers().get("content-type").and_then(|v| v.to_str().ok()).map(|c| c.contains("json")).unwrap_or(false);
        if !is_json {
            return Err(if res.status().is_success() { GggError::SessionInvalid } else { GggError::Other(format!("The GGG website responded with HTTP {status}.")) });
        }
        let body: Value = res.json().await.map_err(|e| GggError::Other(format!("Invalid response from GGG: {e}")))?;
        if let Some(err) = body.get("error") {
            let code = err.get("code").and_then(Value::as_i64).unwrap_or(-1);
            return Err(match code {
                6 | 8 => GggError::SessionInvalid,
                1 => GggError::Other(format!("Stash not found in league {league}.")),
                _ => GggError::Other(format!("GGG website: {}", err.get("message").and_then(Value::as_str).unwrap_or("unknown error"))),
            });
        }
        if !(200..300).contains(&status) {
            return Err(GggError::Other(format!("The GGG website responded with HTTP {status}.")));
        }
        return Ok(body);
    }
    Err(GggError::Other("GGG rate limit: try again in a moment.".into()))
}

/// GET na API oficial com o token atual. `on_401` renova o token e devolve o novo (uma vez só).
pub async fn api_get<F, Fut>(
    client: &reqwest::Client,
    limiter: &Mutex<Limiter>,
    app: &AppHandle,
    user_agent: &str,
    mut token: String,
    endpoint: &str,
    path: &str,
    on_401: F,
) -> Result<Value, GggError>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<String, GggError>>,
{
    let mut refresh = Some(on_401);
    for attempt in 0..3 {
        let req = client
            .get(format!("{API}{path}"))
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header(USER_AGENT, user_agent)
            .header(ACCEPT, "application/json");
        let res = send_limited(limiter, app, endpoint, req).await?;
        let status = res.status().as_u16();
        if status == 401 {
            if let Some(f) = refresh.take() {
                token = f().await?;
                continue;
            }
            return Err(GggError::NotLoggedIn);
        }
        if status == 429 && attempt < 2 {
            continue;
        }
        if !(200..300).contains(&status) {
            let body: Value = res.json().await.unwrap_or_default();
            let msg = if status == 403 {
                "GGG denied access (missing scope). Please sign in again.".to_string()
            } else {
                body.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| format!("HTTP {status}"))
            };
            return Err(GggError::Other(format!("GGG API: {msg}")));
        }
        return res.json().await.map_err(|e| GggError::Other(format!("Invalid response from GGG: {e}")));
    }
    Err(GggError::Other("GGG rate limit: try again in a moment.".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_credentials() {
        assert_eq!(normalize_poesessid(" 0123456789ABCDEF0123456789abcdef ").unwrap(), "0123456789abcdef0123456789abcdef");
        assert!(normalize_poesessid("abc").is_err());
        assert!(normalize_poesessid("0123456789abcdef0123456789abcde\n").is_err());
        assert_eq!(normalize_account_name(" Exile#1234 ").unwrap(), "Exile#1234");
        assert!(normalize_account_name("Exile").is_ok());
        assert!(normalize_account_name("Exile#12").is_err());
        assert!(normalize_account_name("Ex\nile#1234").is_err());
        assert!(normalize_account_name("#1234").is_err());
    }

    #[test]
    fn flattens_legacy_tabs() {
        let tabs: Vec<Value> = serde_json::from_value(json!([
            { "n": "Moedas", "i": 1, "id": "aaaaaaaaaa", "type": "CurrencyStash", "colour": { "r": 217, "g": 164, "b": 65 } },
            { "n": "1", "i": 0, "id": "bbbbbbbbbb", "type": "PremiumStash" },
            { "n": "Pasta", "i": 2, "id": "cccccccccc", "type": "Folder", "children": [{ "n": "Sell", "i": 3, "id": "dddddddddd", "type": "QuadStash" }] }
        ]))
        .unwrap();
        let out = flatten_legacy_tabs(&tabs);
        let names: Vec<(&str, u32)> = out.iter().map(|t| (t.name.as_str(), t.index)).collect();
        assert_eq!(names, vec![("1", 0), ("Moedas", 1), ("Sell", 3)]);
        assert_eq!(out[1].colour.as_deref(), Some("d9a441"));
        assert_eq!(out[2].parent_name.as_deref(), Some("Pasta"));
    }

    #[test]
    fn flattens_api_tabs() {
        let tabs: Vec<Value> = serde_json::from_value(json!([
            { "id": "aaaaaaaaaa", "name": "Folder", "type": "Folder", "index": 1, "children": [{ "id": "bbbbbbbbbb", "name": "Inside", "type": "PremiumStash", "index": 0 }] },
            { "id": "cccccccccc", "name": "Maps", "type": "MapStash", "index": 0, "children": [{ "id": "dddddddddd", "name": "T16", "type": "MapStash" }] }
        ]))
        .unwrap();
        let out = flatten_api_tabs(&tabs);
        assert_eq!(out.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(), vec!["Maps", "Inside"]);
        assert_eq!(out[1].parent_id.as_deref(), Some("aaaaaaaaaa"));
    }
}
