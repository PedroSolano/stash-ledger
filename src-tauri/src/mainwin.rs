//! Janela principal como overlay: o atalho (Shift+Space por padrão) a mostra centralizada por cima
//! do jogo, sempre no topo e com foco; o mesmo atalho, Esc ou um clique de volta no jogo a escondem
//! e devolvem o foco ao jogo. Fechar a janela só a esconde: o app continua na bandeja (alertas,
//! snapshots automáticos e atalhos seguem funcionando). Sair de verdade é pelo menu da bandeja.

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// A janela está aberta por cima do jogo (e não como janela normal).
static OVERLAY: AtomicBool = AtomicBool::new(false);
/// Janela do jogo sobre a qual o overlay foi aberto (HWND).
static GAME: AtomicIsize = AtomicIsize::new(0);

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Mostra sem botão na barra de tarefas: o app vive na bandeja. O Windows recria o botão quando
/// uma janela escondida volta a aparecer, então a flag é reaplicada a cada vez.
fn show(w: &WebviewWindow) {
    let _ = w.set_skip_taskbar(true);
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_skip_taskbar(true);
    let _ = w.set_focus();
}

/// A janela principal está visível (começa escondida; ver `setup`).
static VISIBLE: AtomicBool = AtomicBool::new(false);

/// Avisa a interface (pausa a contagem de atualização quando escondida; Esc só esconde no overlay).
fn visible(app: &AppHandle, v: bool) {
    VISIBLE.store(v, Ordering::Relaxed);
    let overlay = v && OVERLAY.load(Ordering::Relaxed);
    let _ = app.emit_to("main", "main-visible", serde_json::json!({ "visible": v, "overlay": overlay }));
}

/// (visível, aberta por cima do jogo)
pub fn state() -> (bool, bool) {
    (VISIBLE.load(Ordering::Relaxed), OVERLAY.load(Ordering::Relaxed))
}

/// Abre como janela normal (ícone da bandeja, segunda instância).
pub fn show_normal(app: &AppHandle) {
    let Some(w) = main_window(app) else { return };
    OVERLAY.store(false, Ordering::Relaxed);
    let _ = w.set_always_on_top(false);
    show(&w);
    visible(app, true);
}

/// Esconde (bandeja). Se estava por cima do jogo, devolve o foco a ele.
pub fn hide(app: &AppHandle) {
    let Some(w) = main_window(app) else { return };
    let was_overlay = OVERLAY.swap(false, Ordering::Relaxed);
    let _ = w.hide();
    let _ = w.set_always_on_top(false);
    visible(app, false);
    if was_overlay {
        platform::focus(GAME.load(Ordering::Relaxed));
    }
}

/// Atalho do overlay. `game` é o HWND do jogo quando o atalho veio do jogo; 0 quando veio do app.
pub fn toggle(app: &AppHandle, game: isize) {
    let Some(w) = main_window(app) else { return };
    if game == 0 {
        hide(app);
        return;
    }
    GAME.store(game, Ordering::Relaxed);
    OVERLAY.store(true, Ordering::Relaxed);
    if !w.is_maximized().unwrap_or(false) {
        if let Some((x, y, gw, gh)) = platform::window_rect(game) {
            // Cabe no jogo (com folga) e fica centralizada nele.
            let cur = w.inner_size().unwrap_or(PhysicalSize::new(1320, 860));
            let nw = cur.width.min((gw as f64 * 0.92) as u32).max(1);
            let nh = cur.height.min((gh as f64 * 0.92) as u32).max(1);
            if nw != cur.width || nh != cur.height {
                let _ = w.set_size(PhysicalSize::new(nw, nh));
            }
            let size = w.outer_size().unwrap_or(PhysicalSize::new(nw, nh));
            let _ = w.set_position(PhysicalPosition::new(
                x + (gw - size.width as i32) / 2,
                y + (gh - size.height as i32) / 2,
            ));
        }
    }
    let _ = w.set_always_on_top(true);
    show(&w);
    visible(app, true);
}

/// A janela perdeu o foco: se foi para o jogo (clique no jogo, alt-tab de volta), esconde o overlay.
pub fn focus_lost(app: &AppHandle) {
    if !OVERLAY.load(Ordering::Relaxed) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        if OVERLAY.load(Ordering::Relaxed) && platform::game_in_front() {
            OVERLAY.store(false, Ordering::Relaxed);
            if let Some(w) = main_window(&app) {
                let _ = w.hide();
                let _ = w.set_always_on_top(false);
            }
            visible(&app, false);
        }
    });
}

/// Retângulo da janela do jogo (x, y, largura, altura), em pixels físicos.
pub fn game_rect(hwnd: isize) -> Option<(i32, i32, i32, i32)> {
    platform::window_rect(hwnd)
}

pub fn game_in_front() -> bool {
    platform::game_in_front()
}

pub fn focus_game(hwnd: isize) {
    platform::focus(hwnd);
}

#[cfg(windows)]
mod platform {
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, IsWindow, SetForegroundWindow};

    pub fn window_rect(hwnd: isize) -> Option<(i32, i32, i32, i32)> {
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let ok = unsafe { GetWindowRect(hwnd as HWND, &mut r) } != 0;
        (ok && r.right > r.left && r.bottom > r.top).then(|| (r.left, r.top, r.right - r.left, r.bottom - r.top))
    }

    pub fn focus(hwnd: isize) {
        let h = hwnd as HWND;
        if hwnd != 0 && unsafe { IsWindow(h) } != 0 {
            unsafe { SetForegroundWindow(h) };
        }
    }

    pub fn game_in_front() -> bool {
        crate::hotkeys::is_game_window(unsafe { GetForegroundWindow() })
    }
}

#[cfg(not(windows))]
mod platform {
    pub fn window_rect(_hwnd: isize) -> Option<(i32, i32, i32, i32)> {
        None
    }
    pub fn focus(_hwnd: isize) {}
    pub fn game_in_front() -> bool {
        false
    }
}
