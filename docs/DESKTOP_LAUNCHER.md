# FinanceOS desktop launcher

FinanceOS includes a small Windows helper that creates a launcher on your Desktop.

## Install once

From the FinanceOS repository, double-click:

`INSTALL_DESKTOP_LAUNCHER.cmd`

It creates:

`FinanceOS.cmd`

on your Windows Desktop.

## What the Desktop launcher does

Every time you start `FinanceOS.cmd`, it:

1. checks that Git and npm are available,
2. refuses to continue if the repository has uncommitted changes, so local work is not overwritten,
3. fetches GitHub,
4. switches to the `buuk` branch,
5. runs `git pull --ff-only origin buuk`,
6. runs `npm install --no-audit --no-fund`,
7. starts `npm run dev` when port 3000 is not already in use,
8. waits for FinanceOS to respond,
9. opens `http://localhost:3000` in the default browser.

The installer can be run again safely. It overwrites only the generated Desktop launcher.

## Important

The launcher intentionally does **not** use `git reset --hard`, auto-stash, or any other destructive Git command.
If local uncommitted changes are detected, it stops and shows `git status --short`.
