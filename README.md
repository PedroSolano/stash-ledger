# Stash Ledger

See what your Path of Exile stash is worth, priced with **every category on poe.ninja**. Track your net worth over time and your profit per hour. Everything runs on your computer: no account on a third-party server, no middleman.

> This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Features

- **Prices everything poe.ninja covers**: currency, fragments, divination cards, scarabs, essences, oils, omens, tattoos, uniques (including 5L/6L and Foulborn variants), skill gems by level/quality/corruption, maps, cluster jewels, ilvl 82+ bases with influences, beasts, temples and more.
- **Net worth at a glance**: total in divines and chaos, change since your last snapshot, and profit per hour.
- **History chart** of your net worth (6h, 24h, 7 days or all time).
- **Per-tab breakdown** and a searchable, sortable item table.
- **Automatic snapshots** every 5 to 60 minutes.
- **Fits your screen**: the layout adapts to your window size, with a three-column view for ultrawide monitors.
- **Updates itself**: new versions download and install automatically.

## Install

1. Download `StashLedger-Setup-x.y.z.exe` from the [latest release](https://github.com/PedroSolano/stash-ledger/releases/latest).
2. Run it. It installs for your user only and doesn't ask for admin rights.

The installer isn't digitally signed yet, so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**. This only happens on the first install.

## Updates

Every time you open the app, it checks for a new version, downloads it in the background and restarts to install it after a short countdown. Click **Later** to postpone; the update will then be installed when you close the app.

## Signing in

| Option | Status |
|---|---|
| **POESESSID** | Works today. Reads your stash through the Path of Exile website. |
| **Official GGG sign-in** | Not available yet: it requires an app registered with GGG, and GGG is currently not accepting new applications. |
| **Demo mode** | No sign-in. Shows a sample stash priced with real, current poe.ninja prices. |

### Using your POESESSID

1. Open [pathofexile.com](https://www.pathofexile.com) in your browser and sign in.
2. Press **F12**, go to **Application → Cookies → https://www.pathofexile.com** and copy the value of `POESESSID` (32 characters).
3. In Stash Ledger, click **Sign in with POESESSID**, paste it and enter your account name **including the #1234** (exactly as shown on your profile).

**Keep it safe.** Your POESESSID gives full access to your account on the website, so never share it with anyone. Stash Ledger stores it encrypted on your computer and only ever sends it to pathofexile.com. To invalidate it at any time, sign out of the website (you'll then need to paste a new one in the app).

This mode uses a legacy website endpoint that isn't part of GGG's official API. Tools like this have used it for years, but GGG may change or block it at any time.

## Using the app

1. Pick your **league** at the top.
2. Click **Tabs** and select the stash tabs you want to track.
3. Click **Refresh now** to take a snapshot.
4. Optional: turn on **automatic snapshots** in Settings.

Markers in the item table:

- **≈** Approximate price: poe.ninja had no exact match for that variant, so the app used the closest conservative one.
- **low confidence**: fewer than 5 listings on poe.ninja. The item is shown but left out of your total, unless you enable *Include low-confidence prices in totals* in Settings.
- **No price**: poe.ninja doesn't price that item (most rares, for example).

poe.ninja refreshes its prices about every 15 minutes, and the app caches them for that long. Values are shown in chaos and divines, using poe.ninja's current divine rate.

## Troubleshooting

- **"GGG rejected the session"**: your POESESSID expired, usually because you signed out of the website. Copy a new one and sign in again.
- **A tab shows as empty**: map and unique tabs (and possibly some other special tabs) may come back empty through the website endpoint. Most tabs, including currency, fragment, essence and divination card tabs, work fine.
- **"Waiting for GGG rate limit"**: normal when you track many tabs. GGG limits how fast stash tabs can be read, and the app waits instead of getting you rate limited.
- **"N failed" on the Priced items card**: some items couldn't be read. Go to **Settings → Open error log** and attach the file to a [new issue](https://github.com/PedroSolano/stash-ledger/issues). The log never contains your POESESSID.

## Privacy

Your snapshots, settings and session stay on your computer (`%APPDATA%\Stash Ledger`). The app only talks to:

- **pathofexile.com**, to read your stash tabs;
- **poe.ninja**, to fetch prices;
- **web.poecdn.com**, for item icons;
- **github.com**, to check for updates.

There are no analytics and no tracking.

## Uninstall

Go to **Windows Settings → Apps → Installed apps → Stash Ledger → Uninstall**. To also remove your history and saved session, delete the `%APPDATA%\Stash Ledger` folder.
