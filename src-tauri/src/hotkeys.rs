//! Atalhos dentro do jogo (Windows): hook de teclado de baixo nível que só age com o Path of Exile
//! em primeiro plano (ou com a janela do app, para o atalho que a esconde). Fora disso, toda tecla
//! passa direto. Nada é lido da memória ou da tela do jogo.
//!
//! - Atalho do overlay: mostra/esconde a janela principal por cima do jogo.
//! - Comandos de chat: Enter, cola o comando (área de transferência) e Enter — uma ação por tecla,
//!   como pede a política da GGG para ferramentas de terceiros. A área de transferência é restaurada.
//!
//! Formato dos atalhos: "Ctrl+Shift+Alt+<tecla>", com a tecla pelo nome do `KeyboardEvent.code`
//! (posição física). Manter `scan_code` em sincronia com src/shared/hotkeys.ts.

// Fora do Windows (desenvolvimento no WSL) só a parte de configuração é usada.
#![cfg_attr(not(windows), allow(dead_code, unused_imports))]

use serde::Deserialize;
use std::sync::RwLock;

#[derive(Deserialize, Clone, Debug, Default)]
pub struct ChatCommand {
    pub key: String,
    pub command: String,
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct HotkeyConfig {
    pub enabled: bool,
    pub overlay: String,
    #[serde(default, rename = "priceCheck")]
    pub price_check: String,
    pub commands: Vec<ChatCommand>,
}

/// Item copiado pelo atalho de price check, com a posição do cursor e a janela do jogo.
pub struct PriceRequest {
    pub text: String,
    pub x: i32,
    pub y: i32,
    pub game: isize,
}

/// Tecla física (scan code + flag de tecla estendida) e modificadores.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Combo {
    pub scan: u16,
    pub ext: bool,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

/// Scan code (conjunto 1) da tecla pelo nome do `KeyboardEvent.code`, sem os prefixos Key/Digit.
pub fn scan_code(key: &str) -> Option<(u16, bool)> {
    const LETTERS: [(char, u16); 26] = [
        ('A', 0x1E), ('B', 0x30), ('C', 0x2E), ('D', 0x20), ('E', 0x12), ('F', 0x21), ('G', 0x22),
        ('H', 0x23), ('I', 0x17), ('J', 0x24), ('K', 0x25), ('L', 0x26), ('M', 0x32), ('N', 0x31),
        ('O', 0x18), ('P', 0x19), ('Q', 0x10), ('R', 0x13), ('S', 0x1F), ('T', 0x14), ('U', 0x16),
        ('V', 0x2F), ('W', 0x11), ('X', 0x2D), ('Y', 0x15), ('Z', 0x2C),
    ];
    let mut chars = key.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        if let Some(&(_, s)) = LETTERS.iter().find(|(l, _)| *l == c) {
            return Some((s, false));
        }
        if let Some(d) = c.to_digit(10) {
            return Some((if d == 0 { 0x0B } else { 1 + d as u16 }, false));
        }
    }
    if let Some(n) = key.strip_prefix('F').and_then(|n| n.parse::<u16>().ok()) {
        return match n {
            1..=10 => Some((0x3A + n, false)),
            11 => Some((0x57, false)),
            12 => Some((0x58, false)),
            13..=23 => Some((0x64 + n - 13, false)),
            24 => Some((0x76, false)),
            _ => None,
        };
    }
    let s = match key {
        "Space" => (0x39, false),
        "Tab" => (0x0F, false),
        "Backquote" => (0x29, false),
        "Minus" => (0x0C, false),
        "Equal" => (0x0D, false),
        "BracketLeft" => (0x1A, false),
        "BracketRight" => (0x1B, false),
        "Backslash" => (0x2B, false),
        "Semicolon" => (0x27, false),
        "Quote" => (0x28, false),
        "Comma" => (0x33, false),
        "Period" => (0x34, false),
        "Slash" => (0x35, false),
        "IntlBackslash" => (0x56, false),
        "IntlRo" => (0x73, false),
        "Numpad0" => (0x52, false),
        "Numpad1" => (0x4F, false),
        "Numpad2" => (0x50, false),
        "Numpad3" => (0x51, false),
        "Numpad4" => (0x4B, false),
        "Numpad5" => (0x4C, false),
        "Numpad6" => (0x4D, false),
        "Numpad7" => (0x47, false),
        "Numpad8" => (0x48, false),
        "Numpad9" => (0x49, false),
        "NumpadAdd" => (0x4E, false),
        "NumpadSubtract" => (0x4A, false),
        "NumpadMultiply" => (0x37, false),
        "NumpadDecimal" => (0x53, false),
        "NumpadDivide" => (0x35, true),
        "Insert" => (0x52, true),
        "Delete" => (0x53, true),
        "Home" => (0x47, true),
        "End" => (0x4F, true),
        "PageUp" => (0x49, true),
        "PageDown" => (0x51, true),
        "ArrowUp" => (0x48, true),
        "ArrowDown" => (0x50, true),
        "ArrowLeft" => (0x4B, true),
        "ArrowRight" => (0x4D, true),
        _ => return None,
    };
    Some(s)
}

pub fn parse_combo(s: &str) -> Option<Combo> {
    let mut parts: Vec<&str> = s.split('+').map(str::trim).collect();
    let key = parts.pop()?;
    let (scan, ext) = scan_code(key)?;
    let mut c = Combo { scan, ext, ctrl: false, shift: false, alt: false };
    for m in parts {
        match m.to_ascii_lowercase().as_str() {
            "ctrl" => c.ctrl = true,
            "shift" => c.shift = true,
            "alt" => c.alt = true,
            _ => return None,
        }
    }
    Some(c)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Hit {
    ToggleMain,
    PriceCheck,
    Chat(String),
}

#[derive(Default)]
pub struct Bindings {
    enabled: bool,
    paused: bool,
    overlay: Option<Combo>,
    price: Option<Combo>,
    commands: Vec<(Combo, String)>,
}

impl Bindings {
    pub fn from_config(cfg: &HotkeyConfig) -> Self {
        let overlay = parse_combo(&cfg.overlay);
        let price = parse_combo(&cfg.price_check).filter(|p| Some(*p) != overlay);
        let mut commands: Vec<(Combo, String)> = Vec::new();
        for c in cfg.commands.iter().take(30) {
            let text: String = c.command.chars().filter(|ch| !ch.is_control()).take(120).collect();
            let text = text.trim().to_string();
            let Some(combo) = parse_combo(&c.key) else { continue };
            if text.is_empty() || Some(combo) == overlay || Some(combo) == price || commands.iter().any(|(k, _)| *k == combo) {
                continue;
            }
            commands.push((combo, text));
        }
        Bindings { enabled: cfg.enabled, paused: false, overlay, price, commands }
    }

    fn count(&self) -> usize {
        if !self.enabled {
            return 0;
        }
        self.overlay.is_some() as usize + self.price.is_some() as usize + self.commands.len()
    }

    fn active(&self) -> bool {
        self.count() > 0
    }

    /// O que fazer com uma tecla apertada. `in_game`: Path of Exile em primeiro plano;
    /// `in_main`: a janela principal do app em primeiro plano.
    pub fn lookup(&self, c: Combo, in_game: bool, in_main: bool) -> Option<Hit> {
        if !self.enabled || self.paused {
            return None;
        }
        if self.overlay == Some(c) && (in_game || in_main) {
            return Some(Hit::ToggleMain);
        }
        if in_game {
            if self.price == Some(c) {
                return Some(Hit::PriceCheck);
            }
            return self.commands.iter().find(|(k, _)| *k == c).map(|(_, t)| Hit::Chat(t.clone()));
        }
        None
    }
}

static BINDINGS: RwLock<Bindings> = RwLock::new(Bindings {
    enabled: false,
    paused: false,
    overlay: None,
    price: None,
    commands: Vec::new(),
});

/// Aplica a configuração; devolve quantos atalhos ficaram ativos.
pub fn configure(cfg: &HotkeyConfig) -> usize {
    let b = Bindings::from_config(cfg);
    let count = b.count();
    let active = b.active();
    let paused = BINDINGS.read().map(|g| g.paused).unwrap_or(false);
    if let Ok(mut g) = BINDINGS.write() {
        *g = Bindings { paused, ..b };
    }
    if active {
        platform::ensure_hook();
    }
    count
}

pub fn set_paused(paused: bool) {
    if let Ok(mut g) = BINDINGS.write() {
        g.paused = paused;
    }
}

pub use platform::{foreground, init, set_main_window, watch_popup};

/// Algo que fecha a janela do price check: clique fora dela ou Esc no jogo.
pub enum Dismiss {
    ClickOutside,
    Escape,
}

#[cfg(not(windows))]
mod platform {
    use super::{Dismiss, PriceRequest};
    pub fn init(
        _on_toggle: impl Fn(isize) + Send + 'static,
        _on_price: impl Fn(PriceRequest) + Send + 'static,
        _on_dismiss: impl Fn(Dismiss) + Send + 'static,
    ) {
    }
    pub fn set_main_window(_hwnd: isize) {}
    pub fn ensure_hook() {}
    pub fn cursor_pos() -> (i32, i32) {
        (0, 0)
    }
    pub fn foreground() -> isize {
        0
    }
    pub fn watch_popup(_rect: Option<(i32, i32, i32, i32)>) {}
}

#[cfg(windows)]
mod platform {
    use super::{Combo, Dismiss, Hit, PriceRequest, BINDINGS};
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, Once, OnceLock};
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
        KEYEVENTF_KEYUP, MAPVK_VK_TO_VSC, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LSHIFT, VK_MENU, VK_RCONTROL, VK_RETURN,
        VK_RMENU, VK_RSHIFT, VK_SHIFT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetClassNameW, GetCursorPos, GetForegroundWindow, GetMessageW, SetWindowsHookExW, HC_ACTION,
        KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, MSLLHOOKSTRUCT, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP,
        WM_LBUTTONDOWN, WM_MBUTTONDOWN, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN,
    };

    /// Marca as teclas que o próprio app envia, para o hook deixá-las passar.
    const MAGIC: usize = 0x5354_4C44; // "STLD"
    /// Tecla sem função: separa Alt-solto de Alt-apertado para o Windows não abrir o menu da janela.
    const VK_MASK: u16 = 0xE8;

    enum Action {
        Toggle(isize),
        PriceCheck(isize),
        Chat(String),
        Dismiss(Dismiss),
    }

    static TX: OnceLock<Mutex<Sender<Action>>> = OnceLock::new();
    /// Janela do price check aberta: cliques fora deste retângulo (tela, px físicos) a fecham.
    static POPUP: AtomicBool = AtomicBool::new(false);
    static POPUP_RECT: Mutex<(i32, i32, i32, i32)> = Mutex::new((0, 0, 0, 0));
    const SCAN_ESCAPE: u16 = 0x01;
    static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);
    static HOOK: Once = Once::new();
    /// Teclas cujo "apertar" o hook engoliu: o "soltar" (e as repetições) também é engolido.
    static HELD: Mutex<Vec<(u16, bool)>> = Mutex::new(Vec::new());

    /// Liga a thread que executa as ações (fora do hook, que precisa responder em milissegundos).
    pub fn init(
        on_toggle: impl Fn(isize) + Send + 'static,
        on_price: impl Fn(PriceRequest) + Send + 'static,
        on_dismiss: impl Fn(Dismiss) + Send + 'static,
    ) {
        let (tx, rx) = channel::<Action>();
        if TX.set(Mutex::new(tx)).is_err() {
            return;
        }
        std::thread::spawn(move || {
            for a in rx {
                match a {
                    Action::Toggle(game) => on_toggle(game),
                    Action::PriceCheck(game) => {
                        let (x, y) = cursor_pos();
                        if let Some(text) = unsafe { copy_item() } {
                            on_price(PriceRequest { text, x, y, game });
                        }
                    }
                    Action::Chat(text) => unsafe { send_chat(&text) },
                    Action::Dismiss(d) => on_dismiss(d),
                }
            }
        });
    }

    fn dispatch(a: Action) {
        if let Some(tx) = TX.get().and_then(|m| m.lock().ok()) {
            let _ = tx.send(a);
        }
    }

    pub fn cursor_pos() -> (i32, i32) {
        let mut p = POINT { x: 0, y: 0 };
        unsafe { GetCursorPos(&mut p) };
        (p.x, p.y)
    }

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow() as isize }
    }

    /// Liga (com o retângulo da janela) ou desliga a vigia de cliques fora / Esc do price check.
    pub fn watch_popup(rect: Option<(i32, i32, i32, i32)>) {
        if let Some(r) = rect {
            if let Ok(mut g) = POPUP_RECT.lock() {
                *g = r;
            }
            ensure_hook();
        }
        POPUP.store(rect.is_some(), Ordering::SeqCst);
    }

    /// Hook de mouse: só olha cliques, e só com o price check aberto; nunca segura o clique
    /// (ele chega ao jogo normalmente).
    unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 && POPUP.load(Ordering::Relaxed) {
            let msg = wparam as u32;
            if msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN || msg == WM_XBUTTONDOWN {
                let m = &*(lparam as *const MSLLHOOKSTRUCT);
                let inside = POPUP_RECT
                    .try_lock()
                    .map(|r| m.pt.x >= r.0 && m.pt.x < r.2 && m.pt.y >= r.1 && m.pt.y < r.3)
                    .unwrap_or(true);
                if !inside {
                    POPUP.store(false, Ordering::SeqCst);
                    dispatch(Action::Dismiss(Dismiss::ClickOutside));
                }
            }
        }
        CallNextHookEx(null_mut(), code, wparam, lparam)
    }

    pub fn set_main_window(hwnd: isize) {
        MAIN_HWND.store(hwnd, Ordering::Relaxed);
    }

    /// Instala o hook na primeira vez que houver atalho ativo (quem não usa atalhos não tem hook).
    pub fn ensure_hook() {
        HOOK.call_once(|| {
            std::thread::spawn(|| unsafe {
                let module = GetModuleHandleW(null());
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), module, 0);
                if hook.is_null() {
                    return;
                }
                // Mesmo laço de mensagens: cliques fora da janela do price check (custo quase zero
                // quando ela está fechada: o hook retorna na primeira linha).
                SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0);
                // O hook de baixo nível é chamado nesta thread, que precisa de um laço de mensagens.
                let mut msg: MSG = std::mem::zeroed();
                while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {}
            });
        });
    }

    pub fn is_game_window(hwnd: HWND) -> bool {
        if hwnd.is_null() {
            return false;
        }
        let mut buf = [0u16; 64];
        let n = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        n > 0 && String::from_utf16_lossy(&buf[..n as usize]) == "POEWindowClass"
    }

    fn down(vk: u16) -> bool {
        unsafe { GetAsyncKeyState(vk as i32) < 0 }
    }

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let k = &*(lparam as *const KBDLLHOOKSTRUCT);
            if k.dwExtraInfo != MAGIC && handle(k, wparam as u32) {
                return 1;
            }
        }
        CallNextHookEx(null_mut(), code, wparam, lparam)
    }

    unsafe fn handle(k: &KBDLLHOOKSTRUCT, msg: u32) -> bool {
        let pressed = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let released = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        if !pressed && !released {
            return false;
        }
        let mut scan = k.scanCode as u16;
        if scan == 0 {
            scan = MapVirtualKeyW(k.vkCode, MAPVK_VK_TO_VSC) as u16;
        }
        let key = (scan, k.flags & LLKHF_EXTENDED != 0);
        let Ok(mut held) = HELD.lock() else { return false };
        if let Some(i) = held.iter().position(|h| *h == key) {
            if released {
                held.remove(i);
            }
            return true;
        }
        if released {
            return false;
        }

        let fg = GetForegroundWindow();
        let in_game = is_game_window(fg);
        let main = MAIN_HWND.load(Ordering::Relaxed);
        let in_main = main != 0 && fg as isize == main;
        if !in_game && !in_main {
            return false;
        }
        // Esc no jogo com o price check aberto: fecha a janela (e não abre o menu do jogo).
        if in_game && key == (SCAN_ESCAPE, false) && POPUP.load(Ordering::Relaxed) {
            POPUP.store(false, Ordering::SeqCst);
            dispatch(Action::Dismiss(Dismiss::Escape));
            held.push(key);
            return true;
        }
        let combo = Combo { scan: key.0, ext: key.1, ctrl: down(VK_CONTROL), shift: down(VK_SHIFT), alt: down(VK_MENU) };
        let hit = match BINDINGS.read() {
            Ok(b) => b.lookup(combo, in_game, in_main),
            Err(_) => None,
        };
        let Some(hit) = hit else { return false };
        let action = match hit {
            Hit::ToggleMain => Action::Toggle(if in_game { fg as isize } else { 0 }),
            Hit::PriceCheck => Action::PriceCheck(fg as isize),
            Hit::Chat(t) => Action::Chat(t),
        };
        dispatch(action);
        held.push(key);
        true
    }

    fn key(vk: u16, up: bool, ext: bool) -> INPUT {
        let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
        let mut flags = if up { KEYEVENTF_KEYUP } else { 0 };
        if ext {
            flags |= KEYEVENTF_EXTENDEDKEY;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: MAGIC } },
        }
    }

    unsafe fn send(inputs: &[INPUT]) {
        SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    }

    fn tap(vk: u16) -> [INPUT; 2] {
        [key(vk, false, false), key(vk, true, false)]
    }

    /// Solta os modificadores que o jogador ainda segura (do próprio atalho): com Alt apertado,
    /// o Enter viraria Alt+Enter (tela cheia) no jogo.
    pub unsafe fn release_modifiers() {
        let mut inputs = Vec::new();
        let alt = down(VK_LMENU) || down(VK_RMENU);
        if alt {
            inputs.extend(tap(VK_MASK));
        }
        for (vk, ext) in [(VK_LSHIFT, false), (VK_RSHIFT, false), (VK_LCONTROL, false), (VK_RCONTROL, true), (VK_LMENU, false), (VK_RMENU, true)] {
            if down(vk) {
                inputs.push(key(vk, true, ext));
            }
        }
        if !inputs.is_empty() {
            send(&inputs);
        }
    }

    unsafe fn open_clipboard() -> bool {
        let owner = MAIN_HWND.load(Ordering::Relaxed) as HWND;
        for _ in 0..10 {
            if OpenClipboard(owner) != 0 {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    pub unsafe fn clipboard_text() -> Option<Vec<u16>> {
        if !open_clipboard() {
            return None;
        }
        let h = GetClipboardData(CF_UNICODETEXT as u32);
        let mut out = None;
        if !h.is_null() {
            let p = GlobalLock(h) as *const u16;
            if !p.is_null() {
                let mut n = 0;
                while *p.add(n) != 0 {
                    n += 1;
                }
                out = Some(std::slice::from_raw_parts(p, n).to_vec());
                GlobalUnlock(h);
            }
        }
        CloseClipboard();
        out
    }

    pub unsafe fn set_clipboard_text(text: &[u16]) -> bool {
        if !open_clipboard() {
            return false;
        }
        EmptyClipboard();
        let h = GlobalAlloc(GMEM_MOVEABLE, (text.len() + 1) * 2);
        let mut ok = false;
        if !h.is_null() {
            let p = GlobalLock(h) as *mut u16;
            if !p.is_null() {
                std::ptr::copy_nonoverlapping(text.as_ptr(), p, text.len());
                *p.add(text.len()) = 0;
                GlobalUnlock(h);
                // Com sucesso, a memória passa a ser do sistema.
                ok = !SetClipboardData(CF_UNICODETEXT as u32, h).is_null();
            }
        }
        CloseClipboard();
        ok
    }

    /// Ctrl+Alt+C sobre o item sob o cursor: o jogo põe a descrição do item na área de transferência.
    /// Devolve esse texto e restaura o conteúdo anterior.
    unsafe fn copy_item() -> Option<String> {
        release_modifiers();
        let saved = clipboard_text();
        let before = GetClipboardSequenceNumber();
        std::thread::sleep(Duration::from_millis(20));
        // Ctrl+Alt+C, não Ctrl+C: desde a 3.29 o Ctrl+C já copia o formato avançado, mas abrevia as
        // dicas longas ("Raised Spectres(...)"), que aí não batem com os dados de mods. Com Alt o
        // jogo copia a descrição completa ("Raised Spectres (Animated Weapons-Holy Armaments)").
        // O Awakened chega ao mesmo resultado sem querer: ele não solta o Alt do Alt+D.
        // O C entre o Alt descendo e subindo impede o Alt de abrir o menu da janela.
        send(&[
            key(VK_CONTROL, false, false),
            key(VK_LMENU, false, false),
            key(0x43, false, false),
            key(0x43, true, false),
            key(VK_LMENU, true, false),
            key(VK_CONTROL, true, false),
        ]);
        let start = Instant::now();
        let mut text = None;
        while start.elapsed() < Duration::from_millis(800) {
            std::thread::sleep(Duration::from_millis(15));
            if GetClipboardSequenceNumber() != before {
                std::thread::sleep(Duration::from_millis(10));
                text = clipboard_text();
                break;
            }
        }
        // Sem mudança: o cursor não estava sobre um item.
        let text = text?;
        if let Some(s) = saved {
            set_clipboard_text(&s);
        }
        Some(String::from_utf16_lossy(&text))
    }

    unsafe fn send_chat(text: &str) {
        release_modifiers();
        let saved = clipboard_text();
        let wide: Vec<u16> = text.encode_utf16().collect();
        if !set_clipboard_text(&wide) {
            return;
        }
        let pause = || std::thread::sleep(Duration::from_millis(30));
        pause();
        send(&tap(VK_RETURN));
        pause();
        send(&[key(VK_CONTROL, false, false), key(0x56, false, false), key(0x56, true, false), key(VK_CONTROL, true, false)]);
        pause();
        send(&tap(VK_RETURN));
        // Dá tempo de o jogo colar antes de devolver o conteúdo anterior.
        std::thread::sleep(Duration::from_millis(350));
        if let Some(s) = saved {
            set_clipboard_text(&s);
        }
    }
}

#[cfg(windows)]
pub use platform::is_game_window;

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(overlay: &str, cmds: &[(&str, &str)]) -> HotkeyConfig {
        HotkeyConfig {
            enabled: true,
            overlay: overlay.into(),
            price_check: "Alt+D".into(),
            commands: cmds.iter().map(|(k, c)| ChatCommand { key: (*k).into(), command: (*c).into() }).collect(),
        }
    }

    #[test]
    fn parses_combos() {
        let c = parse_combo("Shift+Space").unwrap();
        assert_eq!((c.scan, c.ext, c.shift, c.ctrl, c.alt), (0x39, false, true, false, false));
        let c = parse_combo("Ctrl+Alt+F5").unwrap();
        assert_eq!((c.scan, c.ctrl, c.alt), (0x3F, true, true));
        assert_eq!(parse_combo("Alt+D").unwrap().scan, 0x20);
        assert_eq!(parse_combo("0").unwrap().scan, 0x0B);
        assert_eq!(parse_combo("1").unwrap().scan, 0x02);
        assert_eq!(parse_combo("F12").unwrap().scan, 0x58);
        assert_eq!(parse_combo("F13").unwrap().scan, 0x64);
        assert_eq!(parse_combo("F24").unwrap().scan, 0x76);
        // Mesmo scan code, teclas diferentes: o flag de estendida separa Delete de Num .
        assert_ne!(parse_combo("Delete"), parse_combo("NumpadDecimal"));
        assert!(parse_combo("Hyper+X").is_none());
        assert!(parse_combo("Ctrl+").is_none());
        assert!(parse_combo("F25").is_none());
        assert!(parse_combo("Enter").is_none());
    }

    #[test]
    fn every_key_offered_by_the_ui_is_known() {
        // Mesma lista de src/shared/hotkeys.ts (HOTKEY_KEYS).
        let mut keys: Vec<String> = ('A'..='Z').map(String::from).collect();
        keys.extend(('0'..='9').map(String::from));
        keys.extend((1..=24).map(|n| format!("F{n}")));
        keys.extend(('0'..='9').map(|d| format!("Numpad{d}")));
        for k in [
            "NumpadAdd", "NumpadSubtract", "NumpadMultiply", "NumpadDivide", "NumpadDecimal", "Space", "Tab", "Backquote",
            "Minus", "Equal", "BracketLeft", "BracketRight", "Backslash", "Semicolon", "Quote", "Comma", "Period", "Slash",
            "IntlBackslash", "IntlRo", "Insert", "Delete", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown",
            "ArrowLeft", "ArrowRight",
        ] {
            keys.push(k.into());
        }
        let mut seen = std::collections::HashSet::new();
        for k in &keys {
            let s = scan_code(k).unwrap_or_else(|| panic!("unknown key {k}"));
            assert!(seen.insert(s), "duplicate scan code for {k}");
        }
    }

    #[test]
    fn overlay_works_in_game_and_in_the_app_commands_only_in_game() {
        let b = Bindings::from_config(&cfg("Shift+Space", &[("F5", "/hideout")]));
        let toggle = parse_combo("Shift+Space").unwrap();
        let f5 = parse_combo("F5").unwrap();
        assert_eq!(b.lookup(toggle, true, false), Some(Hit::ToggleMain));
        assert_eq!(b.lookup(toggle, false, true), Some(Hit::ToggleMain));
        assert_eq!(b.lookup(toggle, false, false), None);
        assert_eq!(b.lookup(f5, true, false), Some(Hit::Chat("/hideout".into())));
        assert_eq!(b.lookup(f5, false, true), None);
        // Modificadores precisam bater exatamente.
        assert_eq!(b.lookup(parse_combo("Shift+F5").unwrap(), true, false), None);
    }

    #[test]
    fn price_check_only_in_game_and_wins_over_a_clashing_command() {
        let b = Bindings::from_config(&cfg("Shift+Space", &[("Alt+D", "/clash"), ("F5", "/hideout")]));
        let alt_d = parse_combo("Alt+D").unwrap();
        assert_eq!(b.lookup(alt_d, true, false), Some(Hit::PriceCheck));
        assert_eq!(b.lookup(alt_d, false, true), None);
        assert_eq!(b.lookup(parse_combo("D").unwrap(), true, false), None);
        assert_eq!(b.commands.len(), 1);
        assert_eq!(b.count(), 3);
        // Mesmo atalho do overlay: o price check é descartado.
        let same = Bindings::from_config(&HotkeyConfig { price_check: "Shift+Space".into(), ..cfg("Shift+Space", &[]) });
        assert!(same.price.is_none());
    }

    #[test]
    fn disabled_paused_and_invalid_bindings() {
        let mut b = Bindings::from_config(&cfg(
            "Shift+Space",
            &[("F5", "/hideout"), ("F5", "/dup"), ("Shift+Space", "/clash"), ("Bogus", "/x"), ("F6", "  "), ("F7", "/a\n/b")],
        ));
        assert_eq!(b.commands.len(), 2);
        assert_eq!(b.commands[1].1, "/a/b");
        b.paused = true;
        assert_eq!(b.lookup(parse_combo("F5").unwrap(), true, false), None);
        let off = Bindings::from_config(&HotkeyConfig { enabled: false, ..cfg("Shift+Space", &[]) });
        assert_eq!(off.lookup(parse_combo("Shift+Space").unwrap(), true, false), None);
        assert!(!off.active());
    }
}
