param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [switch]$RemoteStage
)

$ErrorActionPreference = "Stop"

$resolvedRepoRoot = (Resolve-Path $RepoRoot).Path
$dataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "FinanceOS"
} else {
    Join-Path $env:USERPROFILE ".financeos\FinanceOS"
}
$launcherDir = Join-Path $dataDir "launcher"
$cachedBootstrap = Join-Path $launcherDir "desktop-bootstrap.latest.ps1"
$cachedLauncher = Join-Path $launcherDir "start-financeos.latest.ps1"
$bootstrapLog = Join-Path $dataDir "bootstrap.log"

New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null

function Write-BootstrapLog([string]$Message) {
    $line = "{0:u} {1}" -f (Get-Date), $Message
    Add-Content -Path $bootstrapLog -Value $line -Encoding UTF8
}

function Show-BootstrapError([string]$Message) {
    try {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            $Message,
            "FinanceOS Launcher",
            [System.Windows.MessageBoxButton]::OK,
            [System.Windows.MessageBoxImage]::Error
        ) | Out-Null
    } catch {
    }
}

function Invoke-PowerShellScript(
    [string]$Script,
    [string[]]$ExtraArguments
) {
    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $arguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", ('"' + $Script + '"')
    ) + $ExtraArguments

    return Start-Process -FilePath $powerShell -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
}

function Read-RemoteScript([string]$Path) {
    $lines = @(& git -C $resolvedRepoRoot show ("origin/buuk:" + $Path) 2>$null)
    if ($LASTEXITCODE -ne 0 -or $lines.Count -eq 0) {
        return $null
    }
    return ($lines -join [Environment]::NewLine)
}

try {
    Write-BootstrapLog (
        "Bootstrap started" +
        $(if ($RemoteStage) { " (remote stage)." } else { "." })
    )

    if (-not (Test-Path (Join-Path $resolvedRepoRoot ".git"))) {
        throw "FinanceOS Git repository was not found at $resolvedRepoRoot."
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        throw "Git was not found in PATH."
    }

    $remoteAvailable = $false
    & git -C $resolvedRepoRoot fetch origin buuk --prune *> $null
    if ($LASTEXITCODE -eq 0) {
        $remoteAvailable = $true
        Write-BootstrapLog "Fetched origin/buuk."
    } else {
        Write-BootstrapLog "git fetch failed; cached/local fallback will be used where possible."
    }

    # The installed bootstrap is only a stable loader. Whenever GitHub is
    # reachable, run the current bootstrap from origin/buuk so future launcher
    # protocol changes can repair themselves without reinstalling the shortcut.
    if (-not $RemoteStage -and $remoteAvailable) {
        $bootstrapText = Read-RemoteScript "scripts/desktop-bootstrap.ps1"
        if ($bootstrapText) {
            Set-Content -Path $cachedBootstrap -Value $bootstrapText -Encoding UTF8
            Write-BootstrapLog "Downloaded current bootstrap from origin/buuk."

            $remoteProcess = Invoke-PowerShellScript $cachedBootstrap @(
                "-RepoRoot", ('"' + $resolvedRepoRoot + '"'),
                "-RemoteStage"
            )
            exit $remoteProcess.ExitCode
        }

        Write-BootstrapLog "Could not read current bootstrap from origin/buuk; continuing with installed bootstrap."
    }

    $remoteLauncherUpdated = $false
    if ($remoteAvailable) {
        $launcherText = Read-RemoteScript "scripts/start-financeos.ps1"
        if ($launcherText) {
            Set-Content -Path $cachedLauncher -Value $launcherText -Encoding UTF8
            $remoteLauncherUpdated = $true
            Write-BootstrapLog "Downloaded current launcher from origin/buuk."
        } else {
            Write-BootstrapLog "Could not read remote launcher from origin/buuk."
        }
    }

    $launcherToRun = if (Test-Path $cachedLauncher) {
        $cachedLauncher
    } else {
        Join-Path $resolvedRepoRoot "scripts\start-financeos.ps1"
    }

    if (-not (Test-Path $launcherToRun)) {
        throw "No usable FinanceOS launcher is available. Re-run INSTALL_DESKTOP_LAUNCHER.cmd after updating the repository."
    }

    if (-not $remoteLauncherUpdated) {
        Write-BootstrapLog ("Using fallback launcher: " + $launcherToRun)
    }

    $launcherProcess = Invoke-PowerShellScript $launcherToRun @(
        "-RepoRootOverride", ('"' + $resolvedRepoRoot + '"')
    )

    exit $launcherProcess.ExitCode
} catch {
    $message = $_.Exception.Message
    Write-BootstrapLog ("ERROR: " + $message)
    Show-BootstrapError(
        $message +
        [Environment]::NewLine +
        [Environment]::NewLine +
        "Details: " +
        $bootstrapLog
    )
    exit 1
}
