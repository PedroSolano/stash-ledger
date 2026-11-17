# Exile's Companion

A companion for Path of Exile (formerly **Stash Ledger**): see what your stash is worth, priced with **every category on poe.ninja**, track your net worth and profit per hour, price check items in game with an Awakened-style trade search, and use in-game hotkeys. Everything runs on your computer: no account on a third-party server, no middleman.

> This product isn't affiliated with or endorsed by Grinding Gear Games in any way.

## Features

- **Prices everything poe.ninja covers**: currency, fragments, divination cards, scarabs, essences, oils, omens, tattoos, uniques (including 5L/6L and Foulborn variants), skill gems by level/quality/corruption, maps, cluster jewels, ilvl 82+ bases with influences, beasts, temples and more.
- **Net worth at a glance**: total in divines and chaos, change since your last snapshot, and profit per hour.
- **History chart** of your net worth (6h, 24h, 7 days or all time).
- **Per-tab breakdown** and a searchable, sortable item table.
- **Automatic snapshots** every 5 to 60 minutes.
- **Drop alerts**: a siren pops up over the game, with sound, when a valuable item lands in your stash (1 divine or more by default).
- **In-game overlay**: Shift + Space opens the app on top of the game; Alt + D price checks the item under the cursor; hotkeys for chat commands (hideout, Kingsmarch, character select…).
- **Fits your screen**: the layout adapts to your window size, with a three-column view for ultrawide monitors.
- **Light**: a few MB to download and install, low memory use, and a price cache of a couple hundred KB.
- **Updates itself**: new versions download and install automatically, and every update is cryptographically signed.

## Install

1. Download the file ending in **`_x64-setup.exe`** from the [latest release](https://github.com/PedroSolano/stash-ledger/releases/latest).
2. Run it. It installs for your user only and doesn't ask for admin rights.

Requires Windows 10 or 11. The app uses Microsoft Edge WebView2, which comes with Windows 11; on older systems the installer downloads it automatically.

The installer isn't code-signed yet, so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**. This only happens on the first install.

**Used it when it was called Stash Ledger?** Nothing to do: it updates itself to Exile's Companion, moves your history and settings, keeps you signed in, replaces the Start menu (and desktop) shortcut with "Exiles Companion" and removes the old installation. (From version 0.2 or older, uninstall the old version first, then install this one.)

### Starting it with the game

- `exiles-companion.exe --hidden` starts it straight in the tray, without opening the window.
- `exiles-companion.exe --quit` closes a running instance (installing a downloaded update first).

Handy if you start your tools with a script when the game opens.

## Updates

Every time you open the app, it checks for a new version, downloads it in the background and restarts to install it after a short countdown. Click **Later** to postpone; the update will then be installed when you close the app. Updates are only installed if their signature matches the one built into the app.

## Signing in

| Option | Status |
|---|---|
| **POESESSID** | Works today. Reads your stash through the Path of Exile website. |
| **Official GGG sign-in** | Not available yet: it requires an app registered with GGG, and GGG is currently not accepting new applications. |
| **Demo mode** | No sign-in. Shows a sample stash priced with real, current poe.ninja prices. |

### Using your POESESSID

1. Open [pathofexile.com](https://www.pathofexile.com) in your browser and sign in.
2. Press **F12**, go to **Application → Cookies → https://www.pathofexile.com** and copy the value of `POESESSID` (32 characters).
3. In Exile's Companion, click **Sign in with POESESSID**, paste it and enter your account name **including the #1234** (exactly as shown on your profile).

**Keep it safe.** Your POESESSID gives full access to your account on the website, so never share it with anyone. Exile's Companion stores it in the Windows Credential Manager (encrypted by Windows) and only ever sends it to pathofexile.com. To invalidate it at any time, sign out of the website (you'll then need to paste a new one in the app).

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

### In game: overlay and hotkeys

Exile's Companion is meant to stay open while you play. It has no taskbar button. Closing the window only hides it: the app keeps running in the **system tray** (next to the clock), so alerts, automatic snapshots and hotkeys keep working. Click the tray icon to open it again; right-click it and choose **Quit** to close it for real.

- **Shift + Space** in game opens Exile's Companion on top of the game. Press it again, press **Esc** or click the game to hide it; the game gets the focus back.
- **Alt + D** over an item (inventory, stash or ground) opens the **price check** next to the cursor, like Awakened PoE Trade:
  - the **poe.ninja price** right away (uniques with links and variants, currency, gems, maps, cards, cluster jewels, bases…);
  - a **trade search** with the item's mods as filters: each one with its roll, how good the roll is within its tier, and editable minimum/maximum (by default 10% below your roll). Rares use the pseudo totals (total life, total resistances), like Awakened;
  - item filters you can toggle: item level, links, quality, gem level, map tier, influences, corruption, rarity, exact base or any base of the category;
  - the cheapest listings (instant buyout by default) with their age and whether the seller is online, **Show more**, and **Open on the trade site**;
  - for currency, fragments and other stackables, the **bulk exchange** rates;
  - for an **unidentified unique**, the uniques that base can be, with their prices: click one to search it.

  Click the window to use the filters. It closes when you click outside it, press **Esc**, or switch to another program. Searches are anonymous and respect the trade site's rate limits.
- **Chat commands**: by default **F5** goes to your hideout (`/hideout`), **F6** to Kingsmarch (`/kingsmarch`) and **F9** back to character select (`/exit`). Add, remove or change them in **Settings → In-game overlay & hotkeys**: click a key field and press the combination you want.
- Hotkeys only work while Path of Exile is the focused window; everywhere else your keys behave normally. Each hotkey does one thing per key press (opens the chat, types the command, sends it), in line with GGG's rules for third-party tools. It briefly uses the clipboard and then puts your text back.
- Like the alerts, the overlay needs **windowed** or **windowed fullscreen** mode.

### Drop alerts

When a snapshot finds a new item worth **1 divine or more**, a siren shows up in the top-left corner of your screen for a few seconds, with the siren sound, the item's name and its value. It sits on top of the game and doesn't take focus or block clicks.

- Change the minimum value and its currency (**Chaos**, **Exalted** or **Divine Orb**, converted with the current poe.ninja price), turn the sound off or disable alerts in **Settings → Drop alerts**. **Test alert** shows what it looks like.
- Alerts come from snapshots, so turn on **automatic snapshots** (every 5 minutes works well) to get them while you play.
- For stacks, only what was added counts: going from 12 to 14 divines alerts for 2 divines.
- No alert on your first snapshot of a league or for tabs you just started tracking.
- It shows over the game in **windowed** or **windowed fullscreen** mode, not in exclusive fullscreen.

Prices come from a small compressed cache on your computer. While the app is open, it refreshes that cache from poe.ninja on a schedule (every 30 minutes by default, adjustable in Settings) and only downloads categories that actually changed. Values are shown in chaos and divines, using poe.ninja's current divine rate.

## Troubleshooting

- **"GGG rejected the session"**: your POESESSID expired, usually because you signed out of the website. Copy a new one and sign in again.
- **Unique tab shows "not readable"**: with POESESSID sign-in, GGG always returns the Unique Collection tab empty, even when it has items. To count valuable uniques, keep them in a regular, premium or quad tab. Map tabs may have the same problem. Every other tab type works, including currency, fragment, essence, divination card, delve, delirium, blight and flask tabs.
- **A tab shows "empty"**: GGG returned no items for it, which means it really is empty in that league.
- **"Waiting for GGG rate limit"**: normal when you track many tabs. GGG limits how fast stash tabs can be read, and the app waits instead of getting you rate limited.
- **Where did the app go?** Closing the window hides it in the tray (the icon may be under the **^** arrow next to the clock). Click it to bring the window back.
- **Hotkeys do nothing in game**: check that they're turned on in Settings, that the game is in windowed or windowed fullscreen mode, and that no other tool uses the same keys. If you run the game as administrator, Windows doesn't let normal apps see its keys; run both the same way.
- **Price check shows nothing**: make sure the mouse is over the item when you press the key, and that you picked your league in the app.
- **"Trade rate limit"** in the price check: the trade site allows only a few searches per minute. Wait the seconds it shows and search again.
- **A chat command typed nothing**: the commands assume the chat opens with Enter (the game's default).
- **"N failed" on the Priced items card**: some items couldn't be read. Go to **Settings → Open error log** and attach the file to a [new issue](https://github.com/PedroSolano/stash-ledger/issues). The log never contains your POESESSID.

## Privacy

Your snapshots, settings and price cache stay on your computer (`%APPDATA%\Exile's Companion`); your session is kept in the Windows Credential Manager. The app only talks to:

- **pathofexile.com**, to read your stash tabs and, for the price check, to search the trade site (anonymously, without your session);
- **poe.ninja**, to fetch prices;
- **web.poecdn.com**, for item icons;
- **github.com**, to check for updates.

There are no analytics and no tracking.

## Uninstall

Click **Log out** in the app first to remove your saved session, quit it from the tray icon, then go to **Windows Settings → Apps → Installed apps → Exiles Companion → Uninstall** (Windows lists it without the apostrophe). To also remove your history, delete the `%APPDATA%\Exile's Companion` folder.
