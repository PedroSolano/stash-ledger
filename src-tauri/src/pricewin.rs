//! Janelinha do price check, ao lado do cursor. Não pega foco nem cliques (o jogo segue no
//! controle) e some quando o mouse se afasta do item, quando o jogo sai da frente ou após 30 s.
//! É criada no primeiro price check e depois só escondida, para os próximos aparecerem na hora.

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::hotkeys::PriceRequest;

const LABEL: &str = "price";
const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 330.0;
/// Distância (px) que o mouse pode andar antes de a janela sumir.
const MOVE_HIDE: i32 = 140;
const MAX_SHOW: Duration = Duration::from_secs(30);

/// Resultado aguardando a janela terminar de carregar (só no primeiro uso).
static PENDING: Mutex<Option<Value>> = Mutex::new(None);
/// Cursor e janela do jogo no momento do atalho.
static ORIGIN: Mutex<(i32, i32, isize)> = Mutex::new((0, 0, 0));
/// Cada price check invalida o vigia de "esconder" do anterior.
static GEN: AtomicU64 = AtomicU64::new(0);

/// O atalho copiou um item: a interface principal (que tem o motor de preços) calcula o preço
/// e chama `pricecheck_show` com o resultado.
pub fn request(app: &AppHandle, req: PriceRequest) {
    *ORIGIN.lock().unwrap() = (req.x, req.y, req.game);
    let _ = app.emit_to("main", "price-check", json!({ "text": req.text }));
}

fn place(w: &WebviewWindow, x: i32, y: i32, game: isize) {
    let size = w.outer_size().unwrap_or(PhysicalSize::new(WIDTH as u32, HEIGHT as u32));
    let (ww, wh) = (size.width as i32, size.height as i32);
    let (bx, by, bw, bh) = crate::mainwin::game_rect(game).unwrap_or((0, 0, 1920, 1080));
    // À direita do cursor; se não couber, à esquerda. Sempre dentro da janela do jogo.
    let mut px = x + 24;
    if px + ww > bx + bw {
        px = x - 24 - ww;
    }
    let px = px.clamp(bx, (bx + bw - ww).max(bx));
    let py = (y - 30).clamp(by, (by + bh - wh).max(by));
    let _ = w.set_position(PhysicalPosition::new(px, py));
}

pub fn hide(app: &AppHandle) {
    GEN.fetch_add(1, Ordering::SeqCst);
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// Esconde quando o mouse se afasta, o jogo sai da frente ou o tempo acaba.
fn watch(app: &AppHandle, x: i32, y: i32) {
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        let start = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(60));
            if GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            let (cx, cy) = crate::hotkeys::cursor_pos();
            let far = (cx - x).abs().max((cy - y).abs()) > MOVE_HIDE;
            if far || start.elapsed() > MAX_SHOW || !crate::mainwin::game_in_front() {
                if GEN.load(Ordering::SeqCst) == gen {
                    hide(&app);
                }
                return;
            }
        }
    });
}

#[tauri::command]
pub async fn pricecheck_show(app: AppHandle, result: Value) -> Result<(), String> {
    let (x, y, game) = *ORIGIN.lock().unwrap();
    if let Some(w) = app.get_webview_window(LABEL) {
        place(&w, x, y, game);
        // A página desenha e chama `pricecheck_visible`, que mostra a janela.
        app.emit_to(LABEL, "price", result).map_err(|e| e.to_string())?;
    } else {
        *PENDING.lock().unwrap() = Some(result);
        let w = tauri::WebviewWindowBuilder::new(&app, LABEL, tauri::WebviewUrl::App("pricecheck.html".into()))
            .title("Stash Ledger price check")
            .inner_size(WIDTH, HEIGHT)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .shadow(false)
            .visible(false)
            .additional_browser_args(crate::BROWSER_ARGS)
            .build()
            .map_err(|e| e.to_string())?;
        let _ = w.set_ignore_cursor_events(true);
        place(&w, x, y, game);
    }
    watch(&app, x, y);
    Ok(())
}

/// A página terminou de carregar: entrega o resultado pendente (primeiro uso).
#[tauri::command]
pub fn pricecheck_ready() -> Option<Value> {
    PENDING.lock().unwrap().take()
}

/// A página desenhou o resultado: mostra a janela sem tirar o foco do jogo.
#[tauri::command]
pub fn pricecheck_visible(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        crate::show_no_activate(&w);
    }
}
