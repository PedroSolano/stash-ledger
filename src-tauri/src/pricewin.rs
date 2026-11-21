//! Janela do price check (no estilo do Awakened PoE Trade), ao lado do cursor.
//!
//! - Aparece sem tirar o foco do jogo; clicar nela a ativa (filtros, campos de mínimo/máximo).
//! - Fecha ao clicar fora dela (o clique segue para o jogo), com Esc (no jogo ou na janela), quando
//!   outro programa vai para a frente, ou quando um novo price check a substitui.
//! - O tamanho acompanha o conteúdo (a página informa com `pricecheck_resize`).
//! - Criada escondida logo depois que o app abre (`pricecheck_prepare`), com os dados de mods já
//!   carregados, e depois só escondida: o atalho nunca espera o WebView2 subir.

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::hotkeys::{Dismiss, PriceRequest};

const LABEL: &str = "price";
const WIDTH: f64 = 460.0;
const HEIGHT: f64 = 260.0;
/// Margem entre o cursor e a janela.
const GAP: i32 = 24;

/// Página carregada (já chamou `pricecheck_ready`) e resultado aguardando ela terminar de carregar.
/// Juntos no mesmo lock: um resultado nunca se perde entre a página ficar pronta e o evento sair.
static PAGE: Mutex<(bool, Option<Value>)> = Mutex::new((false, None));
/// Cursor e janela do jogo no momento do atalho.
static ORIGIN: Mutex<(i32, i32, isize)> = Mutex::new((0, 0, 0));
/// Cada price check (e cada "esconder") invalida o anterior: um resultado atrasado nunca reaparece.
static GEN: AtomicU64 = AtomicU64::new(0);
/// Geração do price check cujo resultado a página está desenhando.
static SHOWING: AtomicU64 = AtomicU64::new(0);

/// O atalho copiou um item: manda o texto para a janela do price check (que tem o parser e os
/// filtros) junto com o preço do poe.ninja calculado pela interface principal.
pub fn request(app: &AppHandle, req: PriceRequest) {
    *ORIGIN.lock().unwrap() = (req.x, req.y, req.game);
    let _ = app.emit_to("main", "price-check", json!({ "text": req.text }));
}

fn bounds(game: isize) -> (i32, i32, i32, i32) {
    crate::mainwin::game_rect(game).unwrap_or((0, 0, 1920, 1080))
}

/// À direita do cursor; se não couber, à esquerda. Sempre dentro da janela do jogo.
fn place(w: &WebviewWindow) {
    let (x, y, game) = *ORIGIN.lock().unwrap();
    let size = w.outer_size().unwrap_or(PhysicalSize::new(WIDTH as u32, HEIGHT as u32));
    let (ww, wh) = (size.width as i32, size.height as i32);
    let (bx, by, bw, bh) = bounds(game);
    let mut px = x + GAP;
    if px + ww > bx + bw {
        px = x - GAP - ww;
    }
    let px = px.clamp(bx, (bx + bw - ww).max(bx));
    let py = (y - 40).clamp(by, (by + bh - wh).max(by));
    let _ = w.set_position(PhysicalPosition::new(px, py));
    crate::hotkeys::watch_popup(Some((px, py, px + ww, py + wh)));
}

fn hide_window(app: &AppHandle) {
    GEN.fetch_add(1, Ordering::SeqCst);
    crate::hotkeys::watch_popup(None);
    if let Some(w) = app.get_webview_window(LABEL) {
        crate::hide_raw(&w);
    }
}

/// Clique fora / Esc no jogo (vindos dos hooks).
pub fn dismiss(app: &AppHandle, _why: Dismiss) {
    hide_window(app);
}

/// Fecha se outro programa (nem o jogo nem esta janela) for para a frente.
fn watch_foreground(app: &AppHandle, gen: u64) {
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
        if GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        let fg = crate::hotkeys::foreground();
        let (_, _, game) = *ORIGIN.lock().unwrap();
        let mine = app.get_webview_window(LABEL).map(|w| crate::hwnd_of(&w)).unwrap_or(0);
        if fg != 0 && fg != game && fg != mine && !crate::mainwin::game_in_front() {
            if GEN.load(Ordering::SeqCst) == gen {
                hide_window(&app);
            }
            return;
        }
    });
}

fn create(app: &AppHandle) -> Result<WebviewWindow, String> {
    tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("pricecheck.html".into()))
        .title("Exile's Companion price check")
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
        .map_err(|e| e.to_string())
}

/// Cria a janela escondida com antecedência (chamado pela interface logo depois de abrir).
#[tauri::command]
pub async fn pricecheck_prepare(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_none() {
        create(&app)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pricecheck_show(app: AppHandle, result: Value) -> Result<(), String> {
    SHOWING.store(GEN.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
    crate::hotkeys::watch_popup(None);
    let window = app.get_webview_window(LABEL);
    if let Some(w) = &window {
        // Some o resultado anterior enquanto o novo é desenhado.
        crate::hide_raw(w);
    }
    {
        let mut page = PAGE.lock().unwrap();
        if page.0 {
            // A página desenha e chama `pricecheck_visible`, que mostra a janela.
            return app.emit_to(LABEL, "price", result).map_err(|e| e.to_string());
        }
        // Ainda carregando: a página pega o resultado em `pricecheck_ready`.
        page.1 = Some(result);
    }
    if window.is_none() {
        let w = create(&app)?;
        place(&w);
        crate::hotkeys::watch_popup(None);
    }
    Ok(())
}

/// A página terminou de carregar: entrega o resultado pendente, se houver.
#[tauri::command]
pub fn pricecheck_ready() -> Option<Value> {
    let mut page = PAGE.lock().unwrap();
    page.0 = true;
    page.1.take()
}

/// A página desenhou o resultado: mostra a janela sem tirar o foco do jogo. Se outro price check
/// (ou um "esconder") veio no meio tempo, não mostra nada.
#[tauri::command]
pub fn pricecheck_visible(app: AppHandle) {
    let gen = SHOWING.load(Ordering::SeqCst);
    if GEN.load(Ordering::SeqCst) != gen {
        return;
    }
    if let Some(w) = app.get_webview_window(LABEL) {
        place(&w);
        crate::show_no_activate(&w);
        watch_foreground(&app, gen);
    }
}

/// Novo tamanho do conteúdo (px lógicos). Limitado à altura do jogo; a página rola por dentro.
#[tauri::command]
pub fn pricecheck_resize(app: AppHandle, width: f64, height: f64) {
    let Some(w) = app.get_webview_window(LABEL) else { return };
    let (_, _, game) = *ORIGIN.lock().unwrap();
    let scale = w.scale_factor().unwrap_or(1.0);
    let max_h = (bounds(game).3 as f64 / scale - 40.0).max(200.0);
    let _ = w.set_size(LogicalSize::new(width.clamp(300.0, 900.0), height.clamp(80.0, max_h)));
    // Reposiciona (e atualiza a área de "clique dentro") só se estiver aberta.
    if GEN.load(Ordering::SeqCst) == SHOWING.load(Ordering::SeqCst) {
        place(&w);
    }
}

/// Esc / botão fechar dentro da janela: esconde e devolve o foco ao jogo.
#[tauri::command]
pub fn pricecheck_hide(app: AppHandle) {
    hide_window(&app);
    let (_, _, game) = *ORIGIN.lock().unwrap();
    crate::mainwin::focus_game(game);
}
