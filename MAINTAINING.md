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
| `npm test` | TypeScript tests (pricing engine, normalization, compact cache format) |
| `npm run test:rust` | Rust tests (rate limiter, OAuth flow, legacy endpoint parsing, price cache, store) |
| `npm run typecheck` | Type checks the TypeScript code |
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

## Security design

- **Sign-in**: PKCE S256 with 32 bytes of entropy; random `state` compared in constant time; redirect server bound to `127.0.0.1`, closed right after the callback or after 5 min; sign-in happens in the system browser (RFC 8252), not a webview.
- **Secrets**: POESESSID and OAuth tokens live in the Windows Credential Manager (the `keyring` crate); the WebView never sees them.
- **WebView**: strict CSP from `tauri.conf.json`; images only from `web.poecdn.com` and `poe.ninja`; the only capabilities granted are core events, the updater and restart.
- **Commands**: store names, tab IDs, league names, settings and external links are validated in Rust; external links only open for an allow-list of domains.
- **Updates**: signed (see above). The installer itself isn't code-signed.
- **Error log** (`%APPDATA%\Stash Ledger\stash-ledger.log`): messages and item fields only, never cookies or tokens.

## Project structure

```
src-tauri/
  src/lib.rs            commands, app state, startup
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
  shared/types.ts       shared types, including GGG's item format
tests/                  vitest
scripts/setup-wsl.sh    development environment setup
```

## Known limitations

- Without an approved `client_id`, the official sign-in and API stash reading couldn't be tested live; the OAuth flow is tested against a local server.
- Matching for viscera, scrying orbs and imbued gems (recent mechanics) is based on poe.ninja's format and hasn't been checked against real API items.
- POESESSID mode: the legacy endpoint returns the Unique Collection tab as `{"items": [], "uniqueLayout": {}}` even when it has items (confirmed with a real stash), so the UI marks it "not readable". Delve and Delirium tabs work (the response includes `delveLayout`/`deliriumLayout`). Map tabs are untested. The official API (OAuth) handles unique and map tabs through sub-tabs, which `stash_items` already supports. Empty tabs are logged as `tab-empty` with the response shape (field names and sizes only).
- Upgrading from the Electron version (0.2.x): `store::cleanup_legacy` didn't fully remove the old Chromium cache folders from `%APPDATA%\Stash Ledger` on Windows (no error was logged; the same folders delete fine from PowerShell). At most ~8 MB of dead cache stays behind; it's safe to delete.
- Not implemented yet: character inventories (`account:characters` scope), Path of Exile 2, CSV export.
