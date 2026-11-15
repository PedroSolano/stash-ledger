# Maintaining Stash Ledger

Notes for whoever develops and releases the app. The user-facing docs are in [README.md](README.md).

## Development

Requires Node.js 22+ (tested with 26).

```bash
npm install
npm run dev
```

| Script | What it does |
|---|---|
| `npm run dev` | Runs the app in development mode with hot reload |
| `npm run build` / `npm start` | Production build, and running that build |
| `npm test` | Tests for pricing, item normalization, OAuth (simulated flow), legacy endpoint, rate limiter and input validation |
| `npm run price-check -- [league]` | Downloads all 50 poe.ninja categories and prices the demo stash in the terminal |
| `npm run typecheck` | Type checks main/preload and renderer |
| `npm run dist` | Builds the Windows installer locally into `dist/` (doesn't publish) |

Development-only environment hooks (ignored in the installed app):

| Variable | Effect |
|---|---|
| `STASH_LEDGER_USER_DATA=folder` | Uses a separate data folder, so tests don't touch your real data |
| `STASH_LEDGER_DEMO=1` | Starts in demo mode and takes a snapshot |
| `STASH_LEDGER_SCREENSHOT=file.png` | Captures the window to a PNG and quits (`STASH_LEDGER_SCREENSHOT_DELAY`, `STASH_LEDGER_SCREENSHOT_JS` optional) |
| `STASH_LEDGER_WINDOW=WxH`, `STASH_LEDGER_ZOOM=0.5` | Window size and zoom, to test the layouts (zoom 0.5 on 1720x740 ≈ a 3440x1440 ultrawide) |

## Releasing an update

```bash
npm version patch
git push --follow-tags
```

`npm version patch` bumps the version (0.2.0 → 0.2.1), commits and creates the `v0.2.1` tag; use `minor` or `major` for bigger changes. The tag triggers `.github/workflows/release.yml`, which runs tests and type checks, builds the installer with Node 22 and uploads the installer, its blockmap and `latest.yml` to a GitHub release. Installed apps pick up the new version the next time they open (or within 4 hours if left open).

Follow the build in the repository's **Actions** tab, or with `gh run watch`.

Commits use the GitHub no-reply email configured in this repository's local git config, so your personal email isn't published.

## Official GGG sign-in (OAuth)

The app is ready for GGG's **OAuth 2.1 as a public client**: Authorization Code + PKCE (S256) with a temporary local redirect server (`http://127.0.0.1:PORT/callback`). There's no `client_secret`.

To enable it you need:

1. An app registered with GGG (https://www.pathofexile.com/developer/docs) as a *public client*, with the scopes `account:profile account:leagues account:stashes` and a local Redirect URI such as `http://127.0.0.1:8080/callback`. As of November 2026, GGG says *"We are currently unable to process new applications"*.
2. The Client ID and a contact (email or URL, required by GGG in the User-Agent: `OAuth {clientId}/{version} (contact: {contact})`):
   - for releases, as repository variables `POE_CLIENT_ID` and `POE_CONTACT` (Settings → Secrets and variables → Actions → Variables);
   - for local development, in `.env` (see `.env.example`);
   - or per user, in the app's Settings.

GGG rules for public clients that the app follows: access tokens last 10 h and refresh tokens 7 days; rate limits are shared by all public clients (the app reads the `X-Rate-Limit-*` headers and waits); 4xx responses count toward an invalid-request threshold, so the app only retries on 401 (token refresh) and 429 (after `Retry-After`).

## POESESSID mode

Reads stashes through the legacy website endpoint `/character-window/get-stash-items`, the same one used by the original Exilence, Acquisition and Procurement. It's outside GGG's documented API (their docs say using undocumented endpoints is against the Terms of Use, section 7i), so it may break or be blocked without notice.

- Rate limits per IP (read from headers): 30 requests/min, 90 per 30 min, 180 per 2 h. Each tracked tab costs one request per snapshot, plus one to re-read the tab list (the endpoint addresses tabs by position).
- The cookie is validated with a real request before being stored, kept encrypted with `safeStorage` in the main process only, sent only as a `Cookie` header to `www.pathofexile.com` (never in a URL, no redirects followed), and its format is validated (32 hex characters), which also prevents header injection. If GGG rejects the session, it's deleted right away to avoid piling up 403s.
- Item names from this endpoint carry markup like `<<set:MS>><<set:M>><<set:S>>`; `src/main/pricing/normalize.ts` strips it and coerces every field to the expected type before pricing.

## Prices (poe.ninja)

The app queries **every** category documented at https://poe.ninja/docs/api: 19 exchange categories, 29 stash item categories and the 2 legacy stash currency categories (fallback). That's around 21k prices in a challenge league.

| Item | Matching rule |
|---|---|
| Currency, fragments, cards, oils, essences, etc. | Exact name on the exchange |
| Uniques | Name + base; 5L/6L when poe.ninja splits by links; Foulborn by mutated mods; variants by mods (e.g. Mageblood flask count). Unidentified: cheapest unique of that base, flagged approximate |
| Gems | Exact level/quality/corruption; otherwise the best variant at or below the item (approximate) |
| Maps | Base + blighted/blight-ravaged, newest atlas generation |
| Cluster jewels | Enchant + passive count + ilvl bracket (50/68/75/84) |
| Bases (optional) | Uncorrupted normal/magic/rare ilvl 82+ items, by ilvl and influence |
| Temples, scrying orbs | The most valuable room/area found in the mods |

Responsible use: poe.ninja recommends desktop apps go through their own caching backend. Without one, the app caches on disk per league and category, uses conditional requests (ETag/304), at most 3 concurrent requests, never refreshes a category younger than 15 min (5 min when forced) and sends an identifiable User-Agent. A caching proxy (e.g. a Cloudflare Worker) can be plugged in through the "Price server" setting.

## Security design

- **Sign-in**: PKCE S256 with 32 bytes of entropy; random `state` compared in constant time; redirect server bound to `127.0.0.1`, closed right after the callback or after 5 min; sign-in happens in the system browser (RFC 8252), not a webview.
- **Secrets**: OAuth tokens and the POESESSID are encrypted with the OS (`safeStorage`: DPAPI on Windows, Keychain on macOS). Without real encryption (including Linux `basic_text`), they're kept in memory only.
- **Isolated renderer**: `contextIsolation`, `sandbox`, no `nodeIntegration`. All networking and secrets live in the main process; the UI only calls the functions exposed by the preload.
- **Strict CSP** in production; images only from `web.poecdn.com` and `poe.ninja`; no in-app navigation or new windows; external links only to allowed domains.
- **Validated IPC**: only the main window may call; tab IDs and indexes are validated before reaching a URL; settings are sanitized.
- **Auto-update**: downloads are verified against the SHA-512 in the release's `latest.yml`. The installer isn't code-signed.
- **Error log** (`%APPDATA%\Stash Ledger\stash-ledger.log`): messages, stack traces and item fields only, never cookies or tokens.

## Project structure

```
src/
  main/                 main process (network, secrets, files)
    auth/oauth.ts         OAuth + PKCE + local redirect server
    auth/authManager.ts   encrypted tokens, refresh
    auth/sessionAuth.ts   encrypted POESESSID (session mode)
    auth/secureFile.ts    safeStorage-encrypted file
    poe/poeApi.ts         official GGG API (leagues, tabs, items, sub-tabs)
    poe/legacyApi.ts      legacy website endpoint (session mode)
    poe/rateLimiter.ts    dynamic limits from X-Rate-Limit-* headers
    ninja/ninjaClient.ts  poe.ninja with disk cache and ETag
    pricing/              categories, price index, item normalization and matching
    updater.ts            auto-update via GitHub Releases
    controller.ts         snapshots, demo mode and scheduling
    store.ts              settings and history (JSON in %APPDATA%\Stash Ledger)
    log.ts                error log
  preload/index.ts      minimal bridge (window.api)
  renderer/             React UI (layouts in lib/useLayout.ts)
  shared/types.ts       shared types, including GGG's item format
tests/                  vitest
scripts/price-check.ts  live price check
```

## Known limitations

- Without an approved `client_id`, the official sign-in and API stash reading couldn't be tested live; the OAuth flow is tested against a simulated GGG server.
- Matching for viscera, scrying orbs and imbued gems (recent mechanics) is based on poe.ninja's format and hasn't been checked against real API items.
- Not implemented yet: character inventories (`account:characters` scope), Path of Exile 2, CSV export, a custom app icon.
