param(
    [string]$RepoRootOverride = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = if ([string]::IsNullOrWhiteSpace($RepoRootOverride)) {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    (Resolve-Path $RepoRootOverride).Path
}
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
$installedLockHashFile = Join-Path $dataDir "installed-package-lock.sha256"
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

function Invoke-GitProcess([string[]]$Arguments) {
    $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCommand) {
        throw "Git was not found in PATH."
    }

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $gitCommand.Source
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Arguments = (
        $Arguments |
            ForEach-Object { '"' + ([string]$_).Replace('"', '\"') + '"' }
    ) -join " "

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()

    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    return [PSCustomObject]@{
        ExitCode = $process.ExitCode
        StdOut = $stdout
        StdErr = $stderr
    }
}

function Invoke-RepoGit([string[]]$Arguments) {
    return Invoke-GitProcess (@("-C", $repoRoot) + $Arguments)
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
        $statusResult = Invoke-RepoGit @("status", "--porcelain")
        if ($statusResult.ExitCode -ne 0) {
            throw ("Could not read Git status: " + $statusResult.StdErr.Trim())
        }
        $dirty = @(
            $statusResult.StdOut -split "\r?\n" |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
        )
        if ($dirty.Count -gt 0) {
            $dirtyPaths = @(
                $dirty |
                    ForEach-Object {
                        if ($_.Length -gt 3) { $_.Substring(3).Trim() } else { "" }
                    } |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            )

            if (
                $dirtyPaths.Count -eq 1 -and
                $dirtyPaths[0].Replace("\\", "/") -eq "package-lock.json"
            ) {
                $recoveryDir = Join-Path $dataDir "recovery"
                New-Item -ItemType Directory -Force -Path $recoveryDir | Out-Null
                $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
                $lockBackup = Join-Path $recoveryDir ("package-lock." + $timestamp + ".json")
                Copy-Item (Join-Path $repoRoot "package-lock.json") $lockBackup -Force

                Write-LauncherLog (
                    "Only package-lock.json is dirty. Backed it up to " +
                    $lockBackup +
                    " and restoring the tracked version. Older launchers could create this change automatically."
                )
                $restoreResult = Invoke-RepoGit @(
                    "restore", "--source=HEAD", "--", "package-lock.json"
                )
                if ($restoreResult.ExitCode -ne 0) {
                    throw (
                        "Could not restore package-lock.json after creating a recovery backup: " +
                        $restoreResult.StdErr.Trim()
                    )
                }

                $statusResult = Invoke-RepoGit @("status", "--porcelain")
                $dirty = @(
                    $statusResult.StdOut -split "\r?\n" |
                        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
                )
                if ($statusResult.ExitCode -ne 0 -or $dirty.Count -gt 0) {
                    throw "FinanceOS could not return the repository to a clean state after recovering package-lock.json."
                }
            } else {
                throw "FinanceOS has local uncommitted changes. Commit, stash, or discard them before starting FinanceOS."
            }
        }

        Write-LauncherLog "Fetching GitHub."
        $fetchResult = Invoke-RepoGit @("fetch", "origin", "--prune")
        if ($fetchResult.ExitCode -ne 0) {
            throw ("git fetch failed: " + $fetchResult.StdErr.Trim())
        }

        $switchResult = Invoke-RepoGit @("switch", "buuk")
        if ($switchResult.ExitCode -ne 0) {
            throw ("Could not switch to the buuk branch: " + $switchResult.StdErr.Trim())
        }

        $pullResult = Invoke-RepoGit @("pull", "--ff-only", "origin", "buuk")
        if ($pullResult.ExitCode -ne 0) {
            throw (
                "git pull --ff-only failed. FinanceOS did not overwrite local Git history. " +
                $pullResult.StdErr.Trim()
            )
        }

        $shaResult = Invoke-RepoGit @("rev-parse", "HEAD")
        $repoSha = $shaResult.StdOut.Trim()
        if ($shaResult.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($repoSha)) {
            throw "Could not resolve current Git commit."
        }

        $builtSha = if (Test-Path $buildShaFile) {
            (Get-Content $buildShaFile -Raw).Trim()
        } else {
            ""
        }

        $nodeModules = Join-Path $repoRoot "node_modules"
        $packageLock = Join-Path $repoRoot "package-lock.json"
        if (-not (Test-Path $packageLock)) {
            throw "package-lock.json is missing."
        }

        $currentLockHash = (Get-FileHash -Algorithm SHA256 -Path $packageLock).Hash
        $installedLockHash = if (Test-Path $installedLockHashFile) {
            (Get-Content $installedLockHashFile -Raw).Trim()
        } else {
            ""
        }

        $dependenciesNeedInstall =
            -not (Test-Path $nodeModules) -or
            $installedLockHash -ne $currentLockHash

        if ($dependenciesNeedInstall) {
            Write-LauncherLog "Installing exact npm dependencies from package-lock.json."
            & npm ci --no-audit --no-fund *> $null
            if ($LASTEXITCODE -ne 0) {
                throw "npm ci failed. package.json and package-lock.json may be out of sync."
            }

            # npm ci is expected to be reproducible and must not modify tracked
            # repository files. Fail loudly if a future npm version violates
            # that assumption instead of leaving FinanceOS dirty.
            $postInstallStatus = Invoke-RepoGit @("status", "--porcelain")
            if ($postInstallStatus.ExitCode -ne 0) {
                throw "Could not verify Git status after npm ci."
            }
            $postInstallDirty = @(
                $postInstallStatus.StdOut -split "\r?\n" |
                    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            )
            if ($postInstallDirty.Count -gt 0) {
                throw "Dependency installation unexpectedly changed tracked FinanceOS files. Automatic startup stopped to protect the repository."
            }

            Set-Content -Path $installedLockHashFile -Value $currentLockHash -Encoding ASCII
        } else {
            Write-LauncherLog "npm dependencies already match package-lock.json."
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
