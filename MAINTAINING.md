# Maintaining Stash Ledger

Notes for whoever develops and releases the app. The user-facing docs are in [README.md](README.md).

## Architecture

Stash Ledger is a [Tauri 2](https://tauri.app) app: a small Rust backend plus the system WebView (WebView2 on Windows) instead of a bundled Chromium.

- **Rust backend (`src-tauri/`)**: everything that touches the network, secrets or disk. GGG requests (legacy POESESSID endpoint and official OAuth API) with a header-driven rate limiter, OAuth PKCE sign-in, secrets in the OS credential store, the poe.ninja price cache, the data store and the error log. Cookies and tokens never leave this process.
- **TypeScript core (`src/core/`)**: the pricing engine (index, item normalization, matching), demo fixtures and the `Controller` that orchestrates snapshots and schedules. It runs in the WebView and talks to Rust through the `Platform` interface (`src/core/controller.ts`), so it can be tested without Tauri.
- **React UI (`src/renderer/`)**: `src/renderer/src/lib/api.ts` builds `window.api` from the controller, the Rust commands and the Tauri updater.

Lightness was a design goal: the price index is only built while a snapshot runs and is then released; the price cache is one gzip file per league with positional arrays and no item icons (~220 KB for a challenge league); data files above 16 KB are gzipped; the release binary is built for size (`opt-level = "s"`, LTO, stripped).

## Development (WSL)

Development happens in WSL (Ubuntu 24.04), in `~/stash-ledger`. Windows builds are produced by GitHub Actions.

```bash
bash scripts/setup-wsl.sh --system   # Tauri system libraries (asks for your sudo password)
bash scripts/setup-wsl.sh            # Node (nvm), Rust (rustup) and GitHub CLI in your home, no sudo
npm install
npm run dev                          # opens the app through WSLg
```

| Script | What it does |
|---|---|
| `npm run dev` | Runs the app with hot reload (Vite on 127.0.0.1:5173 + Rust in debug) |
| `npm test` | TypeScript tests (pricing engine, normalization, compact cache format, drop alerts, hotkeys, price check) |
| `npm run test:rust` | Rust tests (rate limiter, OAuth flow, legacy endpoint parsing, price cache, store) |
| `npm run typecheck` | Type checks the TypeScript code |
| `bash scripts/check-windows.sh` | Type checks the Rust backend for Windows, including `cfg(windows)` code (needs `rustup target add x86_64-pc-windows-msvc`) |
| `npm run build` | Builds a release bundle for the current OS (on Linux, a Linux bundle; Windows releases come from CI) |

`VITE_DEV_DEMO=1 npm run dev` starts in demo mode and takes a snapshot on launch (development builds only).

In WSL there is no persistent keyring, so a POESESSID you enter during development lasts until WSL restarts.

## Releasing an update

```bash
npm version patch
git push --follow-tags
```

`npm version patch` bumps the version in `package.json` (the app reads it from there), commits and creates the tag; use `minor` or `major` for bigger changes. The tag triggers `.github/workflows/release.yml`, which runs the TypeScript and Rust tests, builds the Windows installer with `tauri-action`, signs the update package and publishes the release with `latest.json`. Installed apps pick it up the next time they open (or within 4 hours if left open).

Follow the build in the repository's **Actions** tab, or with `gh run watch`.

### Update signing key

Updates are signed with a minisign key. The app only installs updates whose signature matches the public key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

- Private key: `~/.tauri/stash-ledger.key` in WSL, password in `~/.tauri/stash-ledger.key.password`. **Back both up somewhere safe.** If the key is lost, installed apps can't verify new updates and every user would have to reinstall manually.
- On GitHub they are the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Official GGG sign-in (OAuth)

The app is ready for GGG's **OAuth 2.1 as a public client**: Authorization Code + PKCE (S256) with a temporary local redirect server (`http://127.0.0.1:PORT/callback`). There's no `client_secret`.

To enable it you need:

1. An app registered with GGG (https://www.pathofexile.com/developer/docs) as a *public client*, with the scopes `account:profile account:leagues account:stashes` and a local Redirect URI such as `http://127.0.0.1:8080/callback`. As of November 2026, GGG says *"We are currently unable to process new applications"*.
2. The Client ID and a contact (email or URL, required by GGG in the User-Agent: `OAuth {clientId}/{version} (contact: {contact})`), either as repository variables `POE_CLIENT_ID` and `POE_CONTACT` (Settings → Secrets and variables → Actions → Variables) so releases ship with them, or per user in the app's Settings.

GGG rules for public clients that the app follows: access tokens last 10 h and refresh tokens 7 days; rate limits are shared by all public clients (the app reads the `X-Rate-Limit-*` headers and waits); 4xx responses count toward an invalid-request threshold, so the app only retries on 401 (token refresh) and 429 (after `Retry-After`).

## POESESSID mode

Reads stashes through the legacy website endpoint `/character-window/get-stash-items`, the same one used by the original Exilence, Acquisition and Procurement. It's outside GGG's documented API (their docs say using undocumented endpoints is against the Terms of Use, section 7i), so it may break or be blocked without notice.

- Rate limits per IP (read from headers): 30 requests/min, 90 per 30 min, 180 per 2 h. Each tracked tab costs one request per snapshot, plus one to re-read the tab list (the endpoint addresses tabs by position).
- The cookie is validated with a real request before being stored, kept in the OS credential store, sent only as a `Cookie` header to `www.pathofexile.com` (never in a URL, no redirects followed) and its format is validated (32 hex characters), which also prevents header injection. If GGG rejects the session, it's deleted right away to avoid piling up 403s.
- Item names from this endpoint carry markup like `<<set:MS>><<set:M>><<set:S>>`; `src/core/pricing/normalize.ts` strips it and coerces every field to the expected type before pricing.

## Prices (poe.ninja)

The backend queries **every** category documented at https://poe.ninja/docs/api: 19 exchange categories, 29 stash item categories and the 2 legacy stash currency categories (fallback). That's around 23k prices in a challenge league.

The cache (`src-tauri/src/ninja.rs`) is refreshed on a schedule by the controller (`priceRefreshMinutes`, default 30, minimum 15) and snapshots read from it; the network is only used during a snapshot if the cache is missing or older than twice the interval. Each refresh uses conditional requests (ETag/304), at most 3 concurrent requests, skips categories younger than 15 min (5 min when forced) and sends an identifiable User-Agent. poe.ninja recommends that desktop apps go through their own caching backend; a caching proxy (e.g. a Cloudflare Worker) can be plugged in through the "Price server" setting.

| Item | Matching rule |
|---|---|
| Currency, fragments, cards, oils, essences, etc. | Exact name on the exchange |
| Uniques | Name + base; 5L/6L when poe.ninja splits by links; Foulborn by mutated mods; variants by mods (e.g. Mageblood flask count). Unidentified: cheapest unique of that base, flagged approximate |
| Gems | Exact level/quality/corruption; otherwise the best variant at or below the item (approximate) |
| Maps | Base + blighted/blight-ravaged, newest atlas generation |
| Cluster jewels | Enchant + passive count + ilvl bracket (50/68/75/84) |
| Bases (optional) | Uncorrupted normal/magic/rare ilvl 82+ items, by ilvl and influence |
| Temples, scrying orbs | The most valuable room/area found in the mods |

## Drop alerts (siren overlay)

- **Detection** (`src/core/alerts.ts`, called from `Controller.doSnapshot`): compares the new snapshot with the previous latest snapshot of the same league, item by item (`key`), and reports counted items whose unit price is at least `alertThresholdDiv × divine` and whose quantity grew. Only tabs that were already in the previous snapshot count, so adding a tab doesn't fire. At most 5 items per alert, sorted by value.
- **Window** (`overlay_alert`/`overlay_ready`/`overlay_done` in `src-tauri/src/lib.rs`): the `overlay` window is created only when there is an alert and closed when it ends, so it costs no memory the rest of the time. Transparent, no decorations, always on top, no taskbar entry, click-through (`set_ignore_cursor_events`) and shown with `SW_SHOWNOACTIVATE` so the game keeps keyboard focus. Top-left of the primary monitor, 16 px in.
- **Page** (`src/renderer/overlay.html`, `src/renderer/src/overlay/`): vanilla TS, a second Vite entry. The siren GIF (`src/renderer/public/siren.gif`) is generated by `scripts/make-siren.mjs` (`npm i --no-save gifenc && node scripts/make-siren.mjs`); the sound is synthesized with WebAudio, no audio file.
- All WebView2 windows share one environment, so their browser arguments must match: `BROWSER_ARGS` in `lib.rs` and `additionalBrowserArgs` in `tauri.conf.json` (which includes `--autoplay-policy=no-user-gesture-required` for the sound).
- With the app open, `stash-ledger.exe --test-alert` fires a test alert without bringing the main window forward (handy to check it over the game).

## In-game overlay and hotkeys

- **Hotkeys** (`src-tauri/src/hotkeys.rs`): a `WH_KEYBOARD_LL` hook on its own thread, installed only once some hotkey is active. It acts only when the foreground window has the class `POEWindowClass` (Path of Exile), or is the app's main window (for the overlay key only); otherwise it passes every key on. Keys are matched by **scan code** (physical position, layout independent); the UI records `KeyboardEvent.code` and both sides share the key list (`src/shared/hotkeys.ts` ↔ `scan_code`, kept in sync by a Rust test). A matched key-down is swallowed together with its repeats and key-up; the action runs on a worker thread because the hook must return within milliseconds.
- **Chat commands**: release held modifiers (with a mask key so a lone Alt doesn't open the window menu), put the command on the clipboard, send Enter, Ctrl+V, Enter with `SendInput`, then restore the previous clipboard text (non-text clipboard content is lost). Events the app injects carry a marker in `dwExtraInfo` so the hook ignores them; injected keys from other software (mouse macro keys) still work.
- **Overlay window** (`src-tauri/src/mainwin.rs`): the main window has no Windows frame (`decorations: false`, title bar in `TitleBar.tsx`) and no taskbar button (`skipTaskbar`, re-applied on every show because Windows recreates the button when a hidden window reappears; no minimize button, since a minimized window would have nothing to restore it from). The overlay key centres it on the game window (shrinking it to fit), makes it topmost and focuses it; hiding returns the focus to the game with `SetForegroundWindow`. Losing focus to the game hides it. Closing the window hides it to the tray; **Quit** (tray menu or Settings) asks the UI to install a downloaded update first, then exits. While hidden, the update countdown is paused so the app never restarts in the middle of a map.
- **Price check** (default Alt+D): the hook swallows the key, the worker releases the held modifiers, sends Ctrl+C and waits for the clipboard sequence number to change (up to 800 ms; no change means the cursor wasn't over an item), reads the item text (since 3.29 always the advanced format) and restores the clipboard. `pricewin::request` sends the text to the main webview, which prices it with poe.ninja (`src/core/pricing/clipboard.ts` + `src/core/pricecheck.ts`, same engine as snapshots, index kept 15 min) and sends `{ text, ninja, league }` to the `price` window.
- **Price window** (`src-tauri/src/pricewin.rs`, `src/renderer/pricecheck.html`, `src/renderer/src/pricecheck/`): created on the first check, then only hidden. Shown with `SW_SHOWNOACTIVATE` (and hidden the same way, see `hide_raw`), never focused until clicked. Sized by the page (`pricecheck_resize`), placed right of the cursor (left if it doesn't fit) inside the game window. Closes on a click outside it (the low-level mouse hook in `hotkeys.rs` watches clicks only while it is open and never swallows them), Esc (in game: swallowed by the keyboard hook; in the window: the page), when another program takes the foreground, or when a new check replaces it.
- **Trade search**: `src/trade/apt/` is Awakened PoE Trade's parser, filters and trade query code (MIT, see `THIRD_PARTY_NOTICES.md`), copied with the same folder layout so its `@/…` imports work through a path alias (`tsconfig.json`, `vite.config.ts`). Changes from upstream: `assets/data/index.ts` builds in-memory lookups instead of fnv1a index files; `trade/common.ts`, the end of `pathofexile-trade.ts` and `pathofexile-bulk.ts` send requests through a transport (`setTradeTransport`) instead of Electron IPC, without the JS rate limiter; luxon/dot-prop replaced by small helpers. `src/trade/index.ts` is the glue the UI uses. The data (`src/renderer/public/trade-data/{stats,items}.ndjson`, ~480 KB compressed) is loaded by the price window on first use.
- **Trade network** (`src-tauri/src/trade.rs`): `/api/trade/search`, `/api/trade/fetch` (max 10 ids, validated) and `/api/trade/exchange`, anonymous (no cookies), with its own header-driven limiter; if the wait would exceed 4 s it returns "try again in N s" instead of blocking. The trade API is not part of GGG's documented API (same situation as the legacy stash endpoint).
- **Updating the data each league**: `bash scripts/update-trade-data.sh` pulls Awakened, copies the data files and lists upstream changes to the ported code for a manual merge.
- **Trying the windows without the game**: `npm run dev:web`, then `http://127.0.0.1:5173/dev/pricecheck.html?item=ring` (or `unid`, `divine`) for the price check and `http://127.0.0.1:5173/dev/app.html` for the main window with a sample session and snapshot. `src/renderer/dev/` mocks the Tauri bridge and the trade responses; not part of the build.

## Look and feel

The app is meant to look like part of the game, with original art only (no GGG files): `src/renderer/src/game.css` draws the panel frame (9-slice SVG in `--poe-frame`: iron border, gold filet, corner diamonds), panel title bands, game-style buttons and toggles, diamond checkboxes, the item header by rarity (`.poe-item-head.rarity-*`) and separators. Fonts are Alegreya SC/Alegreya Sans (OFL), close to the game's Fontin SmallCaps, whose license doesn't clearly allow embedding in an app. `styles.css` (main window), `pricecheck.css` and `overlay.css` build on it.
- `stash-ledger.exe --test-alert` still works with the app hidden.

## Security design

- **Sign-in**: PKCE S256 with 32 bytes of entropy; random `state` compared in constant time; redirect server bound to `127.0.0.1`, closed right after the callback or after 5 min; sign-in happens in the system browser (RFC 8252), not a webview.
- **Secrets**: POESESSID and OAuth tokens live in the Windows Credential Manager (the `keyring` crate); the WebView never sees them.
- **WebView**: strict CSP from `tauri.conf.json`; images only from `web.poecdn.com` and `poe.ninja`; the only capabilities granted are core events, the updater and restart (the alert overlay only gets core events).
- **Commands**: store names, tab IDs, league names, settings and external links are validated in Rust; external links only open for an allow-list of domains.
- **Updates**: signed (see above). The installer itself isn't code-signed.
- **Error log** (`%APPDATA%\Stash Ledger\stash-ledger.log`): messages and item fields only, never cookies or tokens.

## Project structure

```
src-tauri/
  src/lib.rs            commands, app state, startup, tray
  src/hotkeys.rs        in-game hotkeys: keyboard hook, chat commands, clipboard
  src/mainwin.rs        main window as an overlay over the game, hide to tray
  src/pricewin.rs       price check window next to the cursor
  src/ggg.rs            legacy endpoint + official API, tab parsing
  src/oauth.rs          OAuth PKCE flow with local redirect server
  src/ratelimit.rs      dynamic limits from X-Rate-Limit-* headers
  src/ninja.rs          poe.ninja fetch + compact gzip price cache
  src/store.rs          JSON store (gzip above 16 KB), cleanup of Electron-era files
  src/secrets.rs        OS credential store
  src/logfile.rs        error log
  tauri.conf.json       window, CSP, bundle, updater
src/
  core/                 pricing engine, demo fixtures, controller, settings
  renderer/             React UI (layouts in src/lib/useLayout.ts, window.api in src/lib/api.ts)
                        + overlay.html / src/overlay/ (drop alert siren)
  shared/types.ts       shared types, including GGG's item format
  trade/                price check trade search: index.ts (glue) + apt/ (Awakened PoE Trade, MIT)
src-tauri/src/trade.rs  trade site requests (search, fetch, exchange) with rate limits
tests/                  vitest
scripts/setup-wsl.sh    development environment setup
```

## Known limitations

- Without an approved `client_id`, the official sign-in and API stash reading couldn't be tested live; the OAuth flow is tested against a local server.
- Matching for viscera, scrying orbs and imbued gems (recent mechanics) is based on poe.ninja's format and hasn't been checked against real API items.
- POESESSID mode: the legacy endpoint returns the Unique Collection tab as `{"items": [], "uniqueLayout": {}}` even when it has items (confirmed with a real stash), so the UI marks it "not readable". Delve and Delirium tabs work (the response includes `delveLayout`/`deliriumLayout`). Map tabs are untested. The official API (OAuth) handles unique and map tabs through sub-tabs, which `stash_items` already supports. Empty tabs are logged as `tab-empty` with the response shape (field names and sizes only).
- Upgrading from the Electron version (0.2.x): `store::cleanup_legacy` didn't fully remove the old Chromium cache folders from `%APPDATA%\Stash Ledger` on Windows (no error was logged; the same folders delete fine from PowerShell). At most ~8 MB of dead cache stays behind; it's safe to delete.
- Not implemented yet: character inventories (`account:characters` scope), Path of Exile 2, CSV export.
