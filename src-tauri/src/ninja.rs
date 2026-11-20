//! Cache local de preços do poe.ninja.
//!
//! - Busca as 50 categorias documentadas em https://poe.ninja/docs/api.
//! - Guarda só os campos usados na precificação, em listas posicionais, sem ícones de itens.
//! - Um único arquivo gzip por liga (prices/<liga>.json.gz); ligas sem uso há 30 dias são apagadas.
//! - Requisições condicionais (ETag/304), no máximo 3 simultâneas e nunca antes de 15 min
//!   (5 min quando forçado), como pede a documentação do poe.ninja.

use crate::ratelimit::now_ms;
use crate::store;
use futures::stream::{self, StreamExt};
use reqwest::header::{ACCEPT, ETAG, IF_NONE_MATCH, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

pub const EXCHANGE: [&str; 19] = [
    "Currency", "Fragment", "Runegraft", "AllflameEmber", "Tattoo", "Omen", "DjinnCoin", "Ducat", "EnshroudingCrystal",
    "DivinationCard", "Artifact", "Oil", "DeliriumOrb", "Scarab", "Astrolabe", "Thread", "Fossil", "Resonator", "Essence",
];
pub const ITEM: [&str; 29] = [
    "Wombgift", "Corpse", "Viscera", "Incubator", "UniqueWeapon", "UniqueArmour", "UniqueAccessory", "UniqueFlask",
    "UniqueJewel", "ForbiddenJewel", "ShrineBelt", "UniqueTincture", "UniqueRelic", "SkillGem", "ImbuedGem",
    "ClusterJewel", "Map", "BlightedMap", "BlightRavagedMap", "UniqueMap", "ValdoMap", "Invitation", "Memory",
    "IncursionTemple", "ScryingOrb", "BaseType", "Flask", "Beast", "Vial",
];
pub const CURRENCY: [&str; 2] = ["Currency", "Fragment"];

const MIN_AGE_MS: u64 = 15 * 60 * 1000;
const FORCE_MIN_AGE_MS: u64 = 5 * 60 * 1000;
const PRUNE_AFTER_MS: u64 = 30 * 24 * 3600 * 1000;
const CONCURRENCY: usize = 3;

#[derive(Clone, Copy)]
struct Cat {
    kind: &'static str,
    ty: &'static str,
}

impl Cat {
    fn id(&self) -> String {
        format!("{}_{}", self.kind, self.ty)
    }
    fn path(&self, league: &str) -> String {
        let q: String = url::form_urlencoded::Serializer::new(String::new()).append_pair("league", league).append_pair("type", self.ty).finish();
        match self.kind {
            "exchange" => format!("/poe1/api/economy/exchange/current/overview?{q}"),
            "item" => format!("/poe1/api/economy/stash/current/item/overview?{q}"),
            _ => format!("/poe1/api/economy/stash/current/currency/overview?{q}"),
        }
    }
}

fn all() -> Vec<Cat> {
    EXCHANGE.iter().map(|t| Cat { kind: "exchange", ty: t })
        .chain(ITEM.iter().map(|t| Cat { kind: "item", ty: t }))
        .chain(CURRENCY.iter().map(|t| Cat { kind: "currency", ty: t }))
        .collect()
}

#[derive(Serialize, Deserialize, Default)]
pub struct Cache {
    pub v: u32,
    pub league: String,
    pub cats: BTreeMap<String, Entry>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Entry {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    pub at: u64,
    pub d: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub updated_at: Option<u64>,
    pub categories: usize,
    pub failed: Vec<String>,
}

pub fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let t = out.trim_matches('-').to_string();
    if t.is_empty() { "league".into() } else { t }
}

fn cache_path(dir: &Path, league: &str) -> PathBuf {
    dir.join("prices").join(format!("{}.json.gz", slug(league)))
}

/// Versão do formato do cache. Mudou o formato compacto → cache antigo é descartado e baixado de novo.
/// v2: linhas de câmbio levam o volume negociado (para marcar preços de pouca liquidez).
const CACHE_V: u32 = 2;

pub fn load(dir: &Path, league: &str) -> Cache {
    store::read_gz(&cache_path(dir, league))
        .and_then(|b| serde_json::from_slice::<Cache>(&b).ok())
        .filter(|c| c.v == CACHE_V)
        .unwrap_or_else(|| Cache { v: CACHE_V, league: league.to_string(), cats: BTreeMap::new() })
}

fn save(dir: &Path, cache: &Cache) -> Result<(), String> {
    let bytes = serde_json::to_vec(cache).map_err(|e| e.to_string())?;
    store::write_gz(&cache_path(dir, &cache.league), &bytes)
}

/// Apaga caches de ligas que não são usadas há mais de 30 dias (ligas antigas ocupam espaço à toa).
fn prune(dir: &Path, keep: &Path) {
    let Ok(entries) = std::fs::read_dir(dir.join("prices")) else { return };
    let now = std::time::SystemTime::now();
    for e in entries.flatten() {
        let p = e.path();
        if p == keep {
            continue;
        }
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|m| now.duration_since(m).ok()).map(|d| d.as_millis() as u64 > PRUNE_AFTER_MS).unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(p);
        }
    }
}

pub fn status_of(cache: &Cache) -> Status {
    let times: Vec<u64> = cache.cats.values().map(|e| e.at).collect();
    Status { updated_at: times.iter().copied().min(), categories: cache.cats.len(), failed: vec![] }
}

/* ---------- compactação ---------- */

fn f(v: &Value, k: &str) -> f64 {
    v.get(k).and_then(Value::as_f64).unwrap_or(0.0)
}
fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}
/// Arredonda para 4 algarismos significativos: mais do que isso não muda preço nenhum e só ocupa espaço.
fn round_sig(x: f64) -> f64 {
    if x == 0.0 || !x.is_finite() {
        return 0.0;
    }
    let mag = 10f64.powi(3 - x.abs().log10().floor() as i32);
    (x * mag).round() / mag
}

pub fn compact(kind: &str, raw: &Value) -> Value {
    let lines = raw.get("lines").and_then(Value::as_array).cloned().unwrap_or_default();
    match kind {
        "exchange" => {
            let items = raw.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
            let meta: BTreeMap<&str, &Value> = items.iter().map(|i| (s(i, "id"), i)).collect();
            let mut div = 0.0;
            let mut l = Vec::new();
            for line in &lines {
                let id = s(line, "id");
                let value = f(line, "primaryValue");
                if id == "divine" {
                    div = value;
                }
                let Some(m) = meta.get(id) else { continue };
                if value <= 0.0 || s(m, "name").is_empty() {
                    continue;
                }
                // Volume negociado nas últimas 24 h, na moeda primária (chaos): dividido pelo preço dá
                // quantas unidades trocaram de mão. Quase zero = preço de um negócio isolado.
                l.push(json!([s(m, "name"), round_sig(value), s(m, "image"), round_sig(f(line, "volumePrimaryValue"))]));
            }
            if div <= 0.0 {
                let rate = raw.pointer("/core/rates/divine").and_then(Value::as_f64).unwrap_or(0.0);
                if rate > 0.0 {
                    div = 1.0 / rate;
                }
            }
            let mut out = json!({ "k": "e", "l": l });
            if div > 0.0 {
                out["div"] = json!(round_sig(div));
            }
            out
        }
        "item" => {
            let l: Vec<Value> = lines
                .iter()
                .filter(|x| f(x, "chaosValue") > 0.0 && !s(x, "name").is_empty())
                .map(|x| {
                    let mutated: Vec<&str> = x
                        .get("mutatedModifiers")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(|m| m.get("text").and_then(Value::as_str)).collect())
                        .unwrap_or_default();
                    let listings = f(x, "count").max(f(x, "listingCount"));
                    let item_class = x.get("itemClass").and_then(Value::as_i64).unwrap_or(-1);
                    json!([
                        s(x, "name"),
                        s(x, "baseType"),
                        s(x, "variant"),
                        f(x, "links") as i64,
                        f(x, "gemLevel") as i64,
                        f(x, "gemQuality") as i64,
                        if x.get("corrupted").and_then(Value::as_bool) == Some(true) { 1 } else { 0 },
                        f(x, "levelRequired") as i64,
                        item_class,
                        round_sig(f(x, "chaosValue")),
                        listings as i64,
                        if mutated.is_empty() { json!(0) } else { json!(mutated) }
                    ])
                })
                .collect();
            json!({ "k": "i", "l": l })
        }
        _ => {
            let l: Vec<Value> = lines
                .iter()
                .filter(|x| f(x, "chaosEquivalent") > 0.0)
                .map(|x| json!([s(x, "currencyTypeName"), round_sig(f(x, "chaosEquivalent"))]))
                .collect();
            json!({ "k": "c", "l": l })
        }
    }
}

/* ---------- rede ---------- */

enum Fetched {
    NotModified,
    Fresh { etag: Option<String>, d: Value },
}

async fn fetch_one(http: &reqwest::Client, base: &str, ua: &str, cat: Cat, league: &str, etag: Option<String>) -> Result<Fetched, String> {
    let mut req = http.get(format!("{base}{}", cat.path(league))).header(USER_AGENT, ua).header(ACCEPT, "application/json");
    if let Some(tag) = &etag {
        req = req.header(IF_NONE_MATCH, tag);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    if res.status().as_u16() == 304 {
        return Ok(Fetched::NotModified);
    }
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status().as_u16()));
    }
    let etag = res.headers().get(ETAG).and_then(|v| v.to_str().ok()).map(str::to_string);
    let raw: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(Fetched::Fresh { etag, d: compact(cat.kind, &raw) })
}

pub async fn refresh(app: &AppHandle, http: &reqwest::Client, dir: &Path, base: &str, ua: &str, league: &str, force: bool) -> Result<Status, String> {
    let mut cache = load(dir, league);
    let now = now_ms();
    let min_age = if force { FORCE_MIN_AGE_MS } else { MIN_AGE_MS };
    let cats = all();
    let total = cats.len();
    let stale: Vec<Cat> = cats.into_iter().filter(|c| cache.cats.get(&c.id()).map_or(true, |e| now.saturating_sub(e.at) >= min_age)).collect();
    let mut done = total - stale.len();
    let _ = app.emit("progress", json!({ "kind": "prices", "done": done, "total": total }));

    let base = base.trim_end_matches('/').to_string();
    let work: Vec<(Cat, Option<String>)> = stale.into_iter().map(|c| (c, cache.cats.get(&c.id()).and_then(|e| e.etag.clone()))).collect();
    let jobs = work.into_iter().map(|(cat, etag)| {
        let (http, base) = (http.clone(), base.clone());
        async move { (cat, fetch_one(&http, &base, ua, cat, league, etag).await) }
    });
    let mut results = stream::iter(jobs).buffer_unordered(CONCURRENCY);
    let mut failed = Vec::new();
    while let Some((cat, result)) = results.next().await {
        let id = cat.id();
        match result {
            Ok(Fetched::NotModified) => {
                if let Some(e) = cache.cats.get_mut(&id) {
                    e.at = now_ms();
                }
            }
            Ok(Fetched::Fresh { etag, d }) => {
                cache.cats.insert(id, Entry { etag, at: now_ms(), d });
            }
            Err(_) => failed.push(id),
        }
        done += 1;
        let _ = app.emit("progress", json!({ "kind": "prices", "done": done, "total": total }));
    }
    drop(results);
    save(dir, &cache)?;
    prune(dir, &cache_path(dir, league));
    let mut status = status_of(&cache);
    status.failed = failed;
    Ok(status)
}

/// Preços compactos da liga para a interface montar o índice ({ "exchange_Currency": {...}, ... }).
pub fn prices(dir: &Path, league: &str) -> Option<Value> {
    let cache = load(dir, league);
    if cache.cats.is_empty() {
        return None;
    }
    Some(Value::Object(cache.cats.into_iter().map(|(k, e)| (k, e.d)).collect()))
}

pub async fn leagues(http: &reqwest::Client, base: &str, ua: &str) -> Result<Vec<String>, String> {
    let res = http
        .get(format!("{}/poe1/api/economy/leagues", base.trim_end_matches('/')))
        .header(USER_AGENT, ua)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("Could not reach poe.ninja: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("poe.ninja responded {} when listing leagues", res.status().as_u16()));
    }
    let data: Vec<Value> = res.json().await.map_err(|e| e.to_string())?;
    Ok(data.iter().filter_map(|l| l.get("id").and_then(Value::as_str).map(str::to_string)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_list_matches_docs() {
        assert_eq!(all().len(), 50);
        assert!(Cat { kind: "item", ty: "UniqueWeapon" }.path("Hardcore Covens").contains("league=Hardcore+Covens&type=UniqueWeapon"));
    }

    #[test]
    fn compacts_exchange_with_divine() {
        let raw = json!({
            "core": { "rates": { "divine": 0.008786 } },
            "lines": [
                { "id": "divine", "primaryValue": 113.8123, "volumePrimaryValue": 2255695 },
                { "id": "chaos", "primaryValue": 1 },
                { "id": "x", "primaryValue": 0 }
            ],
            "items": [{ "id": "divine", "name": "Divine Orb", "image": "/a.png" }, { "id": "chaos", "name": "Chaos Orb", "image": "/b.png" }, { "id": "x", "name": "X" }]
        });
        let c = compact("exchange", &raw);
        assert_eq!(c["k"], "e");
        assert_eq!(c["div"], json!(113.8));
        // [nome, chaos, ícone, volume negociado em chaos (0 quando a API não informa)]
        assert_eq!(c["l"], json!([["Divine Orb", 113.8, "/a.png", 2256000.0], ["Chaos Orb", 1.0, "/b.png", 0.0]]));
    }

    #[test]
    fn compacts_items_positionally() {
        let raw = json!({ "lines": [
            { "name": "Mageblood", "baseType": "Heavy Belt", "variant": "4 Flasks", "chaosValue": 15943.2, "count": 15, "listingCount": 12, "itemClass": 3,
              "icon": "https://web.poecdn.com/very/long/url.png", "sparkLine": { "data": [1, 2] }, "explicitModifiers": [{ "text": "x" }] },
            { "name": "Foulborn HH", "chaosValue": 30000, "mutatedModifiers": [{ "text": "Culling Strike" }], "corrupted": true, "links": 6 },
            { "name": "", "chaosValue": 5 }, { "name": "Zero", "chaosValue": 0 }
        ]});
        let c = compact("item", &raw);
        assert_eq!(c["l"].as_array().unwrap().len(), 2);
        assert_eq!(c["l"][0], json!(["Mageblood", "Heavy Belt", "4 Flasks", 0, 0, 0, 0, 0, 3, 15940.0, 15, 0]));
        assert_eq!(c["l"][1], json!(["Foulborn HH", "", "", 6, 0, 0, 1, 0, -1, 30000.0, 0, ["Culling Strike"]]));
        // Nada de ícones, sparklines ou modificadores no cache.
        assert!(!c.to_string().contains("poecdn"));
    }

    #[test]
    fn rounds_to_four_significant_digits() {
        assert_eq!(round_sig(0.0025291), 0.002529);
        assert_eq!(round_sig(113.8123), 113.8);
        assert_eq!(round_sig(15943.2), 15940.0);
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Hardcore Covens"), "hardcore-covens");
        assert_eq!(slug("SSF Std (PL123)"), "ssf-std-pl123");
    }
}
