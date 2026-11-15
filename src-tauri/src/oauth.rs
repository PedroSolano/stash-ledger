//! OAuth 2.1 da GGG para clientes públicos: Authorization Code + PKCE (S256) com retorno para um
//! servidor local temporário. O login acontece no navegador do sistema; o app nunca vê a senha.
//! Docs: https://www.pathofexile.com/developer/docs/authorization

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use url::Url;

pub const AUTHORIZE_URL: &str = "https://www.pathofexile.com/oauth/authorize";
pub const TOKEN_URL: &str = "https://www.pathofexile.com/oauth/token";
pub const SCOPES: &str = "account:profile account:leagues account:stashes";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: Option<u64>,
    pub scope: Option<String>,
    pub username: Option<String>,
    pub refresh_token: Option<String>,
}

pub fn random_b64(len: usize) -> String {
    let mut b = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut b);
    URL_SAFE_NO_PAD.encode(b)
}

/// (code_verifier com 32 bytes de entropia, code_challenge S256)
pub fn pkce() -> (String, String) {
    let verifier = random_b64(32);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// Aceita só http://127.0.0.1, http://localhost ou http://[::1] com porta explícita.
pub fn parse_loopback(uri: &str) -> Result<(String, u16, String), String> {
    let url = Url::parse(uri).map_err(|_| "Invalid Redirect URI.".to_string())?;
    let host = url.host_str().unwrap_or("").to_string();
    let ok_host = matches!(host.as_str(), "127.0.0.1" | "localhost" | "[::1]");
    match (url.scheme(), ok_host, url.port()) {
        ("http", true, Some(port)) => Ok((host, port, url.path().to_string())),
        _ => Err("The Redirect URI must be local with a port, e.g. http://127.0.0.1:8080/callback".into()),
    }
}

/// Comparação em tempo constante (o state não pode vazar por tempo de resposta).
fn ct_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>{title}</title>\
<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">\
<style>body{{font-family:system-ui,sans-serif;background:#16130f;color:#eae2d6;display:grid;place-items:center;height:100vh;margin:0}}\
main{{max-width:420px;text-align:center}}h1{{font-size:20px;color:#d9a441}}p{{color:#b8ad9c}}</style></head>\
<body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    )
}

async fn respond(sock: &mut tokio::net::TcpStream, status: &str, body: &str) {
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.write_all(resp.as_bytes()).await;
    let _ = sock.shutdown().await;
}

/// Espera o redirecionamento da GGG no servidor local e devolve o código de autorização.
async fn wait_for_code(listener: &TcpListener, path: &str, state: &str) -> Result<String, String> {
    loop {
        let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let mut len = 0;
        while len < buf.len() {
            match tokio::time::timeout(Duration::from_secs(5), sock.read(&mut buf[len..])).await {
                Ok(Ok(0)) | Err(_) => break,
                Ok(Ok(n)) => {
                    len += n;
                    if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                Ok(Err(_)) => break,
            }
        }
        let head = String::from_utf8_lossy(&buf[..len]);
        let first = head.lines().next().unwrap_or("");
        let mut parts = first.split_whitespace();
        let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        let Ok(url) = Url::parse(&format!("http://localhost{target}")) else {
            respond(&mut sock, "400 Bad Request", "").await;
            continue;
        };
        if method != "GET" || url.path() != path {
            respond(&mut sock, "404 Not Found", "").await;
            continue;
        }
        let q: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();
        if !ct_eq(q.get("state").map(String::as_str).unwrap_or(""), state) {
            respond(&mut sock, "400 Bad Request", &page("Sign-in failed", "Invalid state parameter. Please try again from the app.")).await;
            return Err("Sign-in response had an invalid state (possible forged request).".into());
        }
        if let Some(code) = q.get("code").filter(|_| !q.contains_key("error")) {
            respond(&mut sock, "200 OK", &page("Signed in", "You can close this tab and return to Stash Ledger.")).await;
            return Ok(code.clone());
        }
        let desc = q.get("error_description").or_else(|| q.get("error")).cloned().unwrap_or_else(|| "no code".into());
        respond(&mut sock, "400 Bad Request", &page("Sign-in not authorized", "You can close this tab and try again in the app.")).await;
        return Err(format!("GGG declined the authorization: {desc}"));
    }
}

pub struct FlowConfig<'a> {
    pub client_id: &'a str,
    pub redirect_uri: &'a str,
    pub user_agent: &'a str,
}

/// Fluxo completo. `open` abre a URL de autorização no navegador do sistema.
pub async fn authorize(
    http: &reqwest::Client,
    cfg: FlowConfig<'_>,
    open: impl FnOnce(&str) -> Result<(), String>,
    cancel: oneshot::Receiver<()>,
) -> Result<TokenResponse, String> {
    let (host, port, path) = parse_loopback(cfg.redirect_uri)?;
    let bind_host = if host == "[::1]" { "::1" } else { "127.0.0.1" };
    let listener = TcpListener::bind((bind_host, port)).await.map_err(|e| {
        if e.kind() == std::io::ErrorKind::AddrInUse {
            format!("Port {port} is already in use. Close the other program or register a different Redirect URI.")
        } else {
            format!("Could not start the local sign-in server: {e}")
        }
    })?;
    let (verifier, challenge) = pkce();
    let state = random_b64(16);
    let mut auth = Url::parse(AUTHORIZE_URL).expect("URL fixa");
    auth.query_pairs_mut()
        .append_pair("client_id", cfg.client_id)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPES)
        .append_pair("state", &state)
        .append_pair("redirect_uri", cfg.redirect_uri)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    open(auth.as_str())?;

    let code = tokio::select! {
        r = wait_for_code(&listener, &path, &state) => r?,
        _ = tokio::time::sleep(LOGIN_TIMEOUT) => return Err("Timed out waiting for sign-in in the browser.".into()),
        _ = cancel => return Err("Sign-in cancelled.".into()),
    };
    drop(listener);

    exchange(
        http,
        cfg.user_agent,
        &[
            ("client_id", cfg.client_id),
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", cfg.redirect_uri),
            ("scope", SCOPES),
            ("code_verifier", &verifier),
        ],
    )
    .await
}

pub async fn refresh(http: &reqwest::Client, client_id: &str, user_agent: &str, refresh_token: &str) -> Result<TokenResponse, String> {
    exchange(http, user_agent, &[("client_id", client_id), ("grant_type", "refresh_token"), ("refresh_token", refresh_token)]).await
}

async fn exchange(http: &reqwest::Client, user_agent: &str, params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = http
        .post(TOKEN_URL)
        .header(reqwest::header::USER_AGENT, user_agent)
        .header(reqwest::header::ACCEPT, "application/json")
        .form(params)
        .send()
        .await
        .map_err(|e| format!("Failed to get a token from GGG: {e}"))?;
    let status = res.status();
    let body: serde_json::Value = res.json().await.unwrap_or_default();
    if !status.is_success() || body.get("access_token").and_then(|v| v.as_str()).is_none() {
        let desc = body
            .get("error_description")
            .or_else(|| body.get("error"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return Err(format!("Failed to get a token from GGG: {desc}"));
    }
    serde_json::from_value(body).map_err(|e| format!("Unexpected token response: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_is_s256_of_verifier() {
        let (v, c) = pkce();
        assert_eq!(v.len(), 43);
        assert_eq!(c, URL_SAFE_NO_PAD.encode(Sha256::digest(v.as_bytes())));
        assert_ne!(pkce().0, v);
    }

    #[test]
    fn loopback_only() {
        assert_eq!(parse_loopback("http://127.0.0.1:8080/callback").unwrap(), ("127.0.0.1".into(), 8080, "/callback".into()));
        assert!(parse_loopback("https://example.com/cb").is_err());
        assert!(parse_loopback("http://127.0.0.1/cb").is_err());
        assert!(parse_loopback("http://192.168.0.2:8080/cb").is_err());
    }

    #[test]
    fn constant_time_compare() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
    }

    #[tokio::test]
    async fn full_flow_against_local_server() {
        // Simula o navegador (redirecionado para o servidor local) e checa que state errado é recusado.
        let http = reqwest::Client::new();
        let port = 40_000 + (std::process::id() % 20_000) as u16;
        let redirect = format!("http://127.0.0.1:{port}/callback");
        let (_tx, rx) = oneshot::channel();
        let r = redirect.clone();
        let flow = authorize(
            &http,
            FlowConfig { client_id: "x", redirect_uri: &redirect, user_agent: "ua" },
            move |_url| {
                let r = r.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                    let _ = reqwest::get(format!("{r}?code=evil&state=forged")).await;
                });
                Ok(())
            },
            rx,
        )
        .await;
        assert!(flow.unwrap_err().contains("invalid state"));
    }
}
