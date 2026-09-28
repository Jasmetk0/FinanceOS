$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "FinanceOS"
} else {
    Join-Path $env:USERPROFILE ".financeos\FinanceOS"
}
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$launcherLog = Join-Path $dataDir "launcher.log"
$serverLog = Join-Path $dataDir "server.log"
$pidFile = Join-Path $dataDir "server.pid"
$healthUrl = "http://127.0.0.1:3000/api/health"
$appUrl = "http://127.0.0.1:3000"

function Write-LauncherLog([string]$Message) {
    $line = "{0:u} {1}" -f (Get-Date), $Message
    Add-Content -Path $launcherLog -Value $line -Encoding UTF8
}

function Show-ErrorMessage([string]$Message) {
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            $Message,
            "FinanceOS",
            [System.Windows.MessageBoxButton]::OK,
            [System.Windows.MessageBoxImage]::Error
        ) | Out-Null
    } catch {
    }
}

function Test-FinanceOs {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        return ($health.ok -eq $true -and $health.app -eq "FinanceOS")
    } catch {
        return $false
    }
}

try {
    Write-LauncherLog "Launcher started."

    if (-not (Test-Path (Join-Path $repoRoot ".git"))) {
        throw "FinanceOS Git repository was not found at $repoRoot."
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $git) { throw "Git was not found in PATH." }
    if (-not $npm) { throw "npm was not found in PATH." }

    Push-Location $repoRoot
    try {
        $dirty = git status --porcelain
        if ($LASTEXITCODE -ne 0) {
            throw "Could not read Git status."
        }
        if ($dirty) {
            throw "FinanceOS has local uncommitted changes. Commit, stash, or discard them before starting FinanceOS."
        }

        Write-LauncherLog "Fetching GitHub."
        git fetch origin --prune | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git fetch failed." }

        git switch buuk | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not switch to the buuk branch." }

        git pull --ff-only origin buuk | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "git pull --ff-only failed. FinanceOS did not overwrite local Git history."
        }

        Write-LauncherLog "Updating npm dependencies."
        & npm install --no-audit --no-fund *> $null
        if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
    } finally {
        Pop-Location
    }

    if (-not (Test-FinanceOs)) {
        $portInUse = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
        if ($portInUse) {
            throw "Port 3000 is already used by another application. Close it and start FinanceOS again."
        }

        Write-LauncherLog "Starting hidden Next.js server."
        if (Test-Path $serverLog) {
            Remove-Item $serverLog -Force -ErrorAction SilentlyContinue
        }

        $serverCommand = 'cd /d "' + $repoRoot + '" && npm run dev -- --hostname 127.0.0.1 > "' + $serverLog + '" 2>&1'
        $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $serverCommand -WindowStyle Hidden -PassThru
        Set-Content -Path $pidFile -Value $process.Id -Encoding ASCII

        $deadline = (Get-Date).AddSeconds(75)
        while ((Get-Date) -lt $deadline) {
            if (Test-FinanceOs) { break }
            Start-Sleep -Milliseconds 750
        }

        if (-not (Test-FinanceOs)) {
            throw "FinanceOS did not start within 75 seconds. See $serverLog."
        }
    }

    Write-LauncherLog "Opening FinanceOS."
    Start-Process $appUrl
} catch {
    $message = $_.Exception.Message
    Write-LauncherLog ("ERROR: " + $message)
    $details = $message + [Environment]::NewLine + [Environment]::NewLine + "Details: " + $launcherLog
    Show-ErrorMessage $details
    exit 1
}
