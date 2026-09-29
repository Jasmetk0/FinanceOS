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
$buildLog = Join-Path $dataDir "build.log"
$buildShaFile = Join-Path $dataDir "built.sha"
$pidFile = Join-Path $dataDir "server.pid"
$syncPidFile = Join-Path $dataDir "background-sync.pid"
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

function Test-ProcessId([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    try {
        $processId = [int](Get-Content $Path -Raw)
        if ($processId -le 0) { return $false }
        return $null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)
    } catch {
        return $false
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

        $repoSha = (git rev-parse HEAD).Trim()
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($repoSha)) {
            throw "Could not resolve current Git commit."
        }

        $builtSha = if (Test-Path $buildShaFile) {
            (Get-Content $buildShaFile -Raw).Trim()
        } else {
            ""
        }

        $nodeModules = Join-Path $repoRoot "node_modules"
        $dependenciesNeedInstall =
            $builtSha -ne $repoSha -or -not (Test-Path $nodeModules)

        if ($dependenciesNeedInstall) {
            Write-LauncherLog "Installing exact npm dependencies from package-lock.json."
            & npm ci --no-audit --no-fund *> $null
            if ($LASTEXITCODE -ne 0) {
                throw "npm ci failed. package.json and package-lock.json may be out of sync."
            }

            # npm ci is expected to be reproducible and must not modify tracked
            # repository files. Fail loudly if a future npm version violates
            # that assumption instead of leaving FinanceOS dirty.
            $postInstallDirty = git status --porcelain
            if ($LASTEXITCODE -ne 0) {
                throw "Could not verify Git status after npm ci."
            }
            if ($postInstallDirty) {
                throw "Dependency installation unexpectedly changed tracked FinanceOS files. Automatic startup stopped to protect the repository."
            }
        } else {
            Write-LauncherLog "npm dependencies are already current."
        }

        $nextBuild = Join-Path $repoRoot ".next"
        if ($builtSha -ne $repoSha -or -not (Test-Path $nextBuild)) {
            Write-LauncherLog "Building FinanceOS production bundle."
            & npm run build *> $buildLog
            if ($LASTEXITCODE -ne 0) {
                throw "FinanceOS production build failed. See $buildLog."
            }
            Set-Content -Path $buildShaFile -Value $repoSha -Encoding ASCII
        } else {
            Write-LauncherLog "Production bundle is already current."
        }
    } finally {
        Pop-Location
    }

    # Always restart FinanceOS after updating so the running process matches the
    # freshly pulled code and dependencies.
    foreach ($managedPidFile in @($syncPidFile, $pidFile)) {
        if (Test-Path $managedPidFile) {
            try {
                $managedPid = [int](Get-Content $managedPidFile -Raw)
                if ($managedPid -gt 0 -and (Get-Process -Id $managedPid -ErrorAction SilentlyContinue)) {
                    & taskkill.exe /PID $managedPid /T /F *> $null
                    Start-Sleep -Milliseconds 300
                }
            } catch {
                Write-LauncherLog ("Could not stop stale managed process: " + $_.Exception.Message)
            }
            Remove-Item $managedPidFile -Force -ErrorAction SilentlyContinue
        }
    }

    $portInUse = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($portInUse) {
        throw "Port 3000 is already used by another application. Close it and start FinanceOS again."
    }

    if (-not (Test-FinanceOs)) {
        Write-LauncherLog "Starting hidden FinanceOS production server."
        if (Test-Path $serverLog) {
            Remove-Item $serverLog -Force -ErrorAction SilentlyContinue
        }

        $serverCommand = 'cd /d "' + $repoRoot + '" && npm run start -- --hostname 127.0.0.1 > "' + $serverLog + '" 2>&1'
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

    if (-not (Test-ProcessId $syncPidFile)) {
        Remove-Item $syncPidFile -Force -ErrorAction SilentlyContinue
        $syncScript = Join-Path $repoRoot "scripts\background-sync.ps1"
        if (Test-Path $syncScript) {
            Write-LauncherLog "Starting background sync worker."
            $syncProcess = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", ('"' + $syncScript + '"') -WindowStyle Hidden -PassThru
            Set-Content -Path $syncPidFile -Value $syncProcess.Id -Encoding ASCII
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
