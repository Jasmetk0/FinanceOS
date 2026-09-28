# FinanceOS desktop launcher

FinanceOS ships with a Windows helper that creates two shortcuts on the Desktop:

- `FinanceOS` — update GitHub, update npm dependencies, start FinanceOS in the background, and open it in the browser.
- `FinanceOS Stop` — stop the hidden local FinanceOS server.

## Install once after this upgrade

From the FinanceOS repository, double-click:

`INSTALL_DESKTOP_LAUNCHER.cmd`

The installer replaces the older `FinanceOS.cmd` launcher with Windows shortcuts.

After that, ordinary use does not require an open terminal window.

## What FinanceOS does when started

1. verifies Git and npm,
2. refuses to continue if the repository contains uncommitted changes,
3. fetches GitHub,
4. switches to `buuk`,
5. runs `git pull --ff-only origin buuk`,
6. updates npm dependencies,
7. verifies port 3000 is free or already belongs to FinanceOS,
8. starts Next.js bound to `127.0.0.1` in a hidden process,
9. waits for `/api/health`,
10. starts a hidden background sync worker,
11. opens `http://127.0.0.1:3000`.

The sync worker requests a provider sync every 15 minutes even when the browser is
closed. After a sync it also creates one credentials-free JSON backup per day under
`%LOCALAPPDATA%\FinanceOS\backups` and keeps the latest 60 days.
`FinanceOS Stop` stops both the web server and the background worker.

## Logs

Launcher, server, and background-sync logs are stored under:

`%LOCALAPPDATA%\FinanceOS`

The same directory contains the local database and encryption key.

## Safety

The launcher deliberately never uses destructive Git commands such as
`git reset --hard` and never automatically stashes local work. If the working
tree is dirty, startup stops and shows an error instead of overwriting files.

The local server is bound to `127.0.0.1`, so it is not exposed to the local network.
