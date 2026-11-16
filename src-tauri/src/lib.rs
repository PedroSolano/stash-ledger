//! Backend do Stash Ledger: rede, segredos, arquivos e limites. A interface (TypeScript) roda o
//! motor de preços e só chama os comandos abaixo; cookies e tokens nunca saem deste processo.

mod ggg;
mod logfile;
mod ninja;
mod oauth;
mod ratelimit;
mod secrets;
mod store;

use ggg::{GggError, LegacyCreds, TabInfo};
use ratelimit::{now_ms, Limiter};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex as StdMutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{oneshot, Mutex};

/// Argumentos do WebView2. Precisam ser IGUAIS em todas as janelas (todas compartilham o mesmo
/// ambiente): sem GPU (menos memória) e áudio sem clique prévio (som da sirene no overlay).
/// Manter em sincronia com app.windows[0].additionalBrowserArgs no tauri.conf.json.
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-gpu --autoplay-policy=no-user-gesture-required";
const OVERLAY_W: f64 = 380.0;
const OVERLAY_H: f64 = 360.0;
const SESSION_KEY: &str = "session";
const TOKENS_KEY: &str = "oauth";
const EXTERNAL_ALLOW: [&str; 4] = ["www.pathofexile.com", "pathofexile.com", "poe.ninja", "github.com"];

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    client_id: String,
    #[serde(default)]
    redirect_uri: String,
    #[serde(default)]
    contact: String,
    #[serde(default)]
    ninja_base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    expires_at: u64,
    refresh_token: Option<String>,
    username: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthOut {
    logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    method: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    refreshable: Option<bool>,
}

pub struct AppState {
    data_dir: PathBuf,
    version: String,
    secure: bool,
    /// poe.ninja e troca de token (segue redirecionamentos).
    http: reqwest::Client,
    /// GGG: sem seguir redirecionamentos (um redirect para o login significa sessão inválida).
    ggg: reqwest::Client,
    config: StdMutex<Config>,
    session: StdMutex<Option<LegacyCreds>>,
    tokens: Mutex<Option<Tokens>>,
    limiter: Mutex<Limiter>,
    ninja_lock: Mutex<()>,
    oauth_cancel: StdMutex<Option<oneshot::Sender<()>>>,
    /// Alerta aguardando a janela de overlay terminar de carregar.
    pending_alert: StdMutex<Option<Value>>,
}

impl AppState {
    fn cfg(&self) -> Config {
        self.config.lock().unwrap().clone()
    }

    /// Formato exigido pela GGG: "OAuth {clientId}/{versão} (contact: {contato})".
    fn ggg_ua(&self) -> String {
        let c = self.cfg();
        let id = if c.client_id.is_empty() { "unregistered" } else { &c.client_id };
        let contact = if c.contact.is_empty() { "not-provided" } else { &c.contact };
        format!("OAuth {id}/{} (contact: {contact}) StashLedger", self.version)
    }

    fn ninja_ua(&self) -> String {
        let c = self.cfg();
        if c.contact.is_empty() { format!("StashLedger/{}", self.version) } else { format!("StashLedger/{} (contact: {})", self.version, c.contact) }
    }

    fn ninja_base(&self) -> String {
        let b = self.cfg().ninja_base_url;
        if b.is_empty() { "https://poe.ninja".into() } else { b }
    }

    fn log(&self, context: &str, message: &str, extra: Option<&Value>) {
        logfile::append(&self.data_dir, context, message, extra);
    }

    fn set_session(&self, creds: Option<LegacyCreds>) {
        match &creds {
            Some(c) if self.secure => {
                let _ = secrets::set(SESSION_KEY, &serde_json::to_string(c).unwrap_or_default());
            }
            _ => secrets::delete(SESSION_KEY),
        }
        *self.session.lock().unwrap() = creds;
    }

    async fn set_tokens(&self, tokens: Option<Tokens>) {
        match &tokens {
            Some(t) if self.secure => {
                let _ = secrets::set(TOKENS_KEY, &serde_json::to_string(t).unwrap_or_default());
            }
            _ => secrets::delete(TOKENS_KEY),
        }
        *self.tokens.lock().await = tokens;
    }

    async fn accept_token(&self, res: oauth::TokenResponse) -> Tokens {
        // Clientes públicos recebem tokens de acesso de 10 h.
        let ttl = res.expires_in.unwrap_or(10 * 3600) * 1000;
        let t = Tokens { access_token: res.access_token, expires_at: now_ms() + ttl, refresh_token: res.refresh_token, username: res.username.unwrap_or_default() };
        self.set_tokens(Some(t.clone())).await;
        t
    }

    /// Token válido, renovando com o refresh token quando faltam menos de 2 min.
    async fn access_token(&self) -> Result<String, GggError> {
        let current = self.tokens.lock().await.clone();
        let Some(t) = current else { return Err(GggError::NotLoggedIn) };
        if t.expires_at > now_ms() + 120_000 {
            return Ok(t.access_token);
        }
        self.refresh_token().await
    }

    async fn refresh_token(&self) -> Result<String, GggError> {
        let rt = self.tokens.lock().await.as_ref().and_then(|t| t.refresh_token.clone());
        let Some(rt) = rt else {
            self.set_tokens(None).await;
            return Err(GggError::NotLoggedIn);
        };
        match oauth::refresh(&self.http, &self.cfg().client_id, &self.ggg_ua(), &rt).await {
            Ok(res) => Ok(self.accept_token(res).await.access_token),
            Err(_) => {
                self.set_tokens(None).await;
                Err(GggError::NotLoggedIn)
            }
        }
    }

    async fn method(&self) -> Option<&'static str> {
        if self.tokens.lock().await.is_some() {
            Some("oauth")
        } else if self.session.lock().unwrap().is_some() {
            Some("session")
        } else {
            None
        }
    }

    /// Converte erros da GGG em mensagem; sessão recusada é apagada na hora.
    fn fail(&self, err: GggError) -> String {
        if matches!(err, GggError::SessionInvalid) {
            self.set_session(None);
        }
        err.message()
    }

    async fn api(&self, app: &AppHandle, endpoint: &str, path: &str) -> Result<Value, GggError> {
        let token = self.access_token().await?;
        let ua = self.ggg_ua();
        ggg::api_get(&self.ggg, &self.limiter, app, &ua, token, endpoint, path, || self.refresh_token()).await
    }
}

/* ---------- comandos: básicos ---------- */

#[tauri::command]
fn app_info(state: State<'_, AppState>) -> Value {
    json!({ "version": state.version, "secureStorage": state.secure })
}

#[tauri::command]
fn store_get(state: State<'_, AppState>, name: String) -> Result<Option<Value>, String> {
    store::read_json(&state.data_dir, &name)
}

#[tauri::command]
fn store_set(state: State<'_, AppState>, name: String, value: Value) -> Result<(), String> {
    store::write_json(&state.data_dir, &name, &value)
}

#[tauri::command]
fn store_delete(state: State<'_, AppState>, name: String) -> Result<(), String> {
    store::delete(&state.data_dir, &name)
}

#[tauri::command]
fn configure(state: State<'_, AppState>, cfg: Config) -> Result<(), String> {
    let mut c = cfg;
    c.client_id.retain(|ch| ch.is_ascii_alphanumeric() || "_.-".contains(ch));
    c.contact.retain(|ch| !ch.is_control() && ch != '(' && ch != ')');
    c.contact.truncate(120);
    let base_ok = url::Url::parse(&c.ninja_base_url)
        .map(|u| u.scheme() == "https" || (u.scheme() == "http" && matches!(u.host_str(), Some("127.0.0.1" | "localhost"))))
        .unwrap_or(false);
    if !base_ok {
        c.ninja_base_url = "https://poe.ninja".into();
    }
    *state.config.lock().unwrap() = c;
    Ok(())
}

#[tauri::command]
fn log_error(state: State<'_, AppState>, context: String, message: String, extra: Option<Value>) {
    let ctx: String = context.chars().filter(|c| c.is_ascii_alphanumeric()).take(20).collect();
    state.log(&ctx, &message.chars().take(1000).collect::<String>(), extra.as_ref());
}

#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let ok = url::Url::parse(&url).map(|u| u.scheme() == "https" && u.host_str().map_or(false, |h| EXTERNAL_ALLOW.contains(&h))).unwrap_or(false);
    if !ok {
        return Err("This link is not allowed.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_log(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let log = state.data_dir.join("stash-ledger.log");
    if log.exists() {
        app.opener().reveal_item_in_dir(log).map_err(|e| e.to_string())
    } else {
        app.opener().open_path(state.data_dir.to_string_lossy().to_string(), None::<&str>).map_err(|e| e.to_string())
    }
}

/* ---------- comandos: login ---------- */

#[tauri::command]
async fn auth_status(state: State<'_, AppState>) -> Result<AuthOut, String> {
    if let Some(t) = state.tokens.lock().await.clone() {
        return Ok(AuthOut { logged_in: true, method: Some("oauth"), username: Some(t.username), expires_at: Some(t.expires_at), refreshable: Some(t.refresh_token.is_some()) });
    }
    if let Some(s) = state.session.lock().unwrap().clone() {
        return Ok(AuthOut { logged_in: true, method: Some("session"), username: Some(s.account_name), expires_at: None, refreshable: None });
    }
    Ok(AuthOut { logged_in: false, method: None, username: None, expires_at: None, refreshable: None })
}

/// Valida o POESESSID com uma requisição real antes de guardar qualquer coisa.
#[tauri::command]
async fn session_login(app: AppHandle, state: State<'_, AppState>, account_name: String, poesessid: String, league: String) -> Result<Option<Vec<TabInfo>>, String> {
    let creds = LegacyCreds { poesessid: ggg::normalize_poesessid(&poesessid)?, account_name: ggg::normalize_account_name(&account_name)? };
    let ua = state.ninja_ua();
    let tabs = match ggg::legacy_request(&state.ggg, &state.limiter, &app, &ua, &creds, &league, 0, true).await {
        Ok(body) => Some(ggg::flatten_legacy_tabs(body.get("tabs").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]))),
        // Conta sem stash nesta liga ainda prova que a sessão é válida; só 401/403 reprovam.
        Err(GggError::Other(m)) if m.starts_with("Stash not found") => None,
        Err(e) => return Err(e.message()),
    };
    state.set_tokens(None).await;
    state.set_session(Some(creds));
    Ok(tabs)
}

#[tauri::command]
async fn oauth_login(app: AppHandle, state: State<'_, AppState>) -> Result<AuthOut, String> {
    let cfg = state.cfg();
    if cfg.client_id.is_empty() {
        return Err("Set your GGG app Client ID in Settings before signing in.".into());
    }
    let (tx, rx) = oneshot::channel();
    if let Some(prev) = state.oauth_cancel.lock().unwrap().replace(tx) {
        let _ = prev.send(());
    }
    let ua = state.ggg_ua();
    let opener = app.clone();
    let res = oauth::authorize(
        &state.http,
        oauth::FlowConfig { client_id: &cfg.client_id, redirect_uri: &cfg.redirect_uri, user_agent: &ua },
        move |url| opener.opener().open_url(url, None::<&str>).map_err(|e| e.to_string()),
        rx,
    )
    .await;
    state.oauth_cancel.lock().unwrap().take();
    let t = state.accept_token(res?).await;
    state.set_session(None);
    Ok(AuthOut { logged_in: true, method: Some("oauth"), username: Some(t.username), expires_at: Some(t.expires_at), refreshable: Some(t.refresh_token.is_some()) })
}

#[tauri::command]
fn oauth_cancel(state: State<'_, AppState>) {
    if let Some(tx) = state.oauth_cancel.lock().unwrap().take() {
        let _ = tx.send(());
    }
}

#[tauri::command]
async fn logout(state: State<'_, AppState>) -> Result<(), String> {
    state.set_tokens(None).await;
    state.set_session(None);
    Ok(())
}

/* ---------- comandos: stash ---------- */

#[tauri::command]
async fn account_leagues(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let data = state.api(&app, "leagues", "/account/leagues").await.map_err(|e| state.fail(e))?;
    Ok(data
        .get("leagues")
        .and_then(Value::as_array)
        .map(|ls| {
            ls.iter()
                .filter(|l| l.get("realm").and_then(Value::as_str).map_or(true, |r| r == "pc"))
                .filter_map(|l| l.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
async fn stash_tabs(app: AppHandle, state: State<'_, AppState>, league: String) -> Result<Vec<TabInfo>, String> {
    match state.method().await {
        Some("oauth") => {
            let path = format!("/stash/{}", urlencode(&league));
            let data = state.api(&app, "stash-list", &path).await.map_err(|e| state.fail(e))?;
            Ok(ggg::flatten_api_tabs(data.get("stashes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])))
        }
        Some(_) => {
            let creds = state.session.lock().unwrap().clone().ok_or("Sign in first.")?;
            let ua = state.ninja_ua();
            let body = ggg::legacy_request(&state.ggg, &state.limiter, &app, &ua, &creds, &league, 0, true).await.map_err(|e| state.fail(e))?;
            Ok(ggg::flatten_legacy_tabs(body.get("tabs").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])))
        }
        None => Err("Sign in first.".into()),
    }
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect::<String>().replace('+', "%20")
}

/// Resumo estrutural de uma resposta: para cada campo, o tipo e o tamanho (sem valores).
fn response_shape(v: &Value) -> Value {
    let Some(obj) = v.as_object() else { return json!(format!("{}", type_name(v))) };
    Value::Object(
        obj.iter()
            .filter(|(k, _)| k.as_str() != "tabs")
            .map(|(k, x)| {
                let desc = match x {
                    Value::Array(a) => json!(format!("array[{}]", a.len())),
                    Value::Object(o) => json!(format!("object{{{}}}", o.keys().take(8).cloned().collect::<Vec<_>>().join(","))),
                    other => json!(type_name(other)),
                };
                (k.clone(), desc)
            })
            .collect(),
    )
}

fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn items_of(v: Option<&Value>) -> Vec<Value> {
    v.and_then(|x| x.get("items")).and_then(Value::as_array).cloned().unwrap_or_default()
}

#[tauri::command]
async fn stash_items(app: AppHandle, state: State<'_, AppState>, league: String, tab: TabInfo) -> Result<Vec<Value>, String> {
    match state.method().await {
        Some("oauth") => {
            if !ggg::is_stash_id(&tab.id) || tab.parent_id.as_deref().is_some_and(|p| !ggg::is_stash_id(p)) {
                return Err("Invalid tab ID.".into());
            }
            let l = urlencode(&league);
            if let Some(parent) = &tab.parent_id {
                let data = state.api(&app, "stash", &format!("/stash/{l}/{parent}/{}", tab.id)).await.map_err(|e| state.fail(e))?;
                let inner = data.pointer("/stash/children").and_then(Value::as_array).and_then(|c| c.iter().find(|x| x.get("id").and_then(Value::as_str) == Some(&tab.id)));
                return Ok(items_of(inner.or(data.get("stash"))));
            }
            let data = state.api(&app, "stash", &format!("/stash/{l}/{}", tab.id)).await.map_err(|e| state.fail(e))?;
            let mut items = items_of(data.get("stash"));
            // Abas de mapas/únicos vêm divididas em sub-abas: busca cada uma.
            let children = data.pointer("/stash/children").and_then(Value::as_array).cloned().unwrap_or_default();
            for child in children {
                let child_items = items_of(Some(&child));
                if !child_items.is_empty() {
                    items.extend(child_items);
                    continue;
                }
                let Some(cid) = child.get("id").and_then(Value::as_str).filter(|c| ggg::is_stash_id(c)) else { continue };
                let sub = state.api(&app, "stash", &format!("/stash/{l}/{}/{cid}", tab.id)).await.map_err(|e| state.fail(e))?;
                let inner = sub.pointer("/stash/children").and_then(Value::as_array).and_then(|c| c.iter().find(|x| x.get("id").and_then(Value::as_str) == Some(cid)));
                items.extend(items_of(inner));
            }
            Ok(items)
        }
        Some(_) => {
            let creds = state.session.lock().unwrap().clone().ok_or("Sign in first.")?;
            let ua = state.ninja_ua();
            let body = ggg::legacy_request(&state.ggg, &state.limiter, &app, &ua, &creds, &league, tab.index, false).await.map_err(|e| state.fail(e))?;
            let items = body.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
            if items.is_empty() {
                // Diagnóstico: só a forma da resposta (campos e tamanhos), nunca conteúdo nem cookie.
                state.log("tab-empty", &format!("{} [{}] index {}", tab.name, tab.kind, tab.index), Some(&response_shape(&body)));
            }
            Ok(items)
        }
        None => Err("Sign in first.".into()),
    }
}

/* ---------- comandos: preços ---------- */

#[tauri::command]
async fn ninja_leagues(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    ninja::leagues(&state.http, &state.ninja_base(), &state.ninja_ua()).await
}

#[tauri::command]
fn ninja_status(state: State<'_, AppState>, league: String) -> ninja::Status {
    ninja::status_of(&ninja::load(&state.data_dir, &league))
}

#[tauri::command]
async fn ninja_refresh(app: AppHandle, state: State<'_, AppState>, league: String, force: bool) -> Result<ninja::Status, String> {
    let _guard = state.ninja_lock.lock().await;
    let status = ninja::refresh(&app, &state.http, &state.data_dir, &state.ninja_base(), &state.ninja_ua(), &league, force).await?;
    if !status.failed.is_empty() {
        state.log("prices", &format!("{} categories failed", status.failed.len()), Some(&json!(status.failed)));
    }
    Ok(status)
}

#[tauri::command]
fn ninja_prices(state: State<'_, AppState>, league: String) -> Option<Value> {
    ninja::prices(&state.data_dir, &league)
}

/* ---------- overlay de alerta (sirene) ---------- */

/// Mostra a janela por cima de tudo SEM ativá-la: o jogo continua com o foco do teclado.
fn show_no_activate(w: &tauri::WebviewWindow) {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
        };
        if let Ok(hwnd) = w.hwnd() {
            let h = hwnd.0 as windows_sys::Win32::Foundation::HWND;
            unsafe {
                ShowWindow(h, SW_SHOWNOACTIVATE);
                SetWindowPos(h, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
            }
            return;
        }
    }
    let _ = w.show();
}

/// Canto superior esquerdo do monitor principal (onde o jogo costuma rodar), com 16 px de margem.
fn overlay_position(app: &AppHandle) -> (f64, f64) {
    if let Ok(Some(m)) = app.primary_monitor() {
        let s = m.scale_factor();
        let p = m.position();
        return (p.x as f64 / s + 16.0, p.y as f64 / s + 16.0);
    }
    (16.0, 16.0)
}

/// Abre o overlay com o alerta. A janela só existe enquanto o alerta está na tela (leveza):
/// é criada aqui e fechada pelo próprio overlay em `overlay_done`.
#[tauri::command]
async fn overlay_alert(app: AppHandle, state: State<'_, AppState>, alert: Value) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("overlay") {
        app.emit_to("overlay", "alert", alert).map_err(|e| e.to_string())?;
        show_no_activate(&w);
        return Ok(());
    }
    *state.pending_alert.lock().unwrap() = Some(alert);
    let (x, y) = overlay_position(&app);
    let w = tauri::WebviewWindowBuilder::new(&app, "overlay", tauri::WebviewUrl::App("overlay.html".into()))
        .title("Stash Ledger alert")
        .inner_size(OVERLAY_W, OVERLAY_H)
        .position(x, y)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .shadow(false)
        .visible(false)
        .additional_browser_args(BROWSER_ARGS)
        .build()
        .map_err(|e| e.to_string())?;
    // Cliques atravessam o overlay e vão para o jogo.
    let _ = w.set_ignore_cursor_events(true);
    Ok(())
}

/// Chamado pelo overlay quando terminou de carregar: entrega o alerta e mostra a janela.
#[tauri::command]
fn overlay_ready(app: AppHandle, state: State<'_, AppState>) -> Option<Value> {
    let alert = state.pending_alert.lock().unwrap().take();
    if let Some(w) = app.get_webview_window("overlay") {
        show_no_activate(&w);
    }
    alert
}

/// Fim do alerta: fecha a janela e libera a memória do WebView.
#[tauri::command]
fn overlay_done(app: AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.close();
    }
}

/* ---------- inicialização ---------- */

fn build_state(app: &AppHandle) -> Result<AppState, Box<dyn std::error::Error>> {
    // Mesma pasta da versão Electron (%APPDATA%\Stash Ledger), para manter histórico e configurações.
    let data_dir = app.path().config_dir()?.join("Stash Ledger");
    std::fs::create_dir_all(&data_dir)?;
    store::cleanup_legacy(&data_dir);
    let secure = secrets::available();
    let session = if secure { secrets::get(SESSION_KEY).and_then(|s| serde_json::from_str::<LegacyCreds>(&s).ok()) } else { None };
    let tokens = if secure { secrets::get(TOKENS_KEY).and_then(|s| serde_json::from_str::<Tokens>(&s).ok()) } else { None };
    // Token vencido sem refresh token não serve para nada.
    let tokens = tokens.filter(|t| t.expires_at > now_ms() || t.refresh_token.is_some());
    let http = reqwest::Client::builder().timeout(Duration::from_secs(45)).build()?;
    let ggg = reqwest::Client::builder().timeout(Duration::from_secs(45)).redirect(reqwest::redirect::Policy::none()).build()?;
    Ok(AppState {
        data_dir,
        version: app.package_info().version.to_string(),
        secure,
        http,
        ggg,
        config: StdMutex::new(Config::default()),
        session: StdMutex::new(session),
        tokens: Mutex::new(tokens),
        limiter: Mutex::new(Limiter::default()),
        ninja_lock: Mutex::new(()),
        oauth_cancel: StdMutex::new(None),
        pending_alert: StdMutex::new(None),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Uma instância só: evita dois processos disputando a porta do login e os arquivos.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // `stash-ledger.exe --test-alert` com o app aberto: dispara o alerta de teste sem
            // trazer a janela para frente (útil para ver o overlay por cima do jogo).
            if argv.iter().any(|a| a == "--test-alert") {
                let _ = app.emit_to("main", "test-alert", ());
                return;
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let state = build_state(app.handle())?;
            app.manage(state);
            Ok(())
        })
        // Fechar a janela principal encerra o app mesmo com um alerta na tela.
        .on_window_event(|w, e| {
            if w.label() == "main" && matches!(e, tauri::WindowEvent::Destroyed) {
                if let Some(o) = w.app_handle().get_webview_window("overlay") {
                    let _ = o.close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            store_get,
            store_set,
            store_delete,
            configure,
            log_error,
            open_external,
            open_log,
            auth_status,
            session_login,
            oauth_login,
            oauth_cancel,
            logout,
            account_leagues,
            stash_tabs,
            stash_items,
            ninja_leagues,
            ninja_status,
            ninja_refresh,
            ninja_prices,
            overlay_alert,
            overlay_ready,
            overlay_done
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stash Ledger");
}
