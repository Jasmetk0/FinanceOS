param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

$resolvedRepoRoot = (Resolve-Path $RepoRoot).Path
$dataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "FinanceOS"
} else {
    Join-Path $env:USERPROFILE ".financeos\FinanceOS"
}
$launcherDir = Join-Path $dataDir "launcher"
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

try {
    Write-BootstrapLog "Bootstrap started."

    if (-not (Test-Path (Join-Path $resolvedRepoRoot ".git"))) {
        throw "FinanceOS Git repository was not found at $resolvedRepoRoot."
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        throw "Git was not found in PATH."
    }

    $remoteLauncherUpdated = $false

    & git -C $resolvedRepoRoot fetch origin buuk --prune *> $null
    if ($LASTEXITCODE -eq 0) {
        $launcherLines = @(& git -C $resolvedRepoRoot show "origin/buuk:scripts/start-financeos.ps1" 2>$null)
        if ($LASTEXITCODE -eq 0 -and $launcherLines.Count -gt 0) {
            $launcherText = $launcherLines -join [Environment]::NewLine
            Set-Content -Path $cachedLauncher -Value $launcherText -Encoding UTF8
            $remoteLauncherUpdated = $true
            Write-BootstrapLog "Downloaded current launcher from origin/buuk."
        } else {
            Write-BootstrapLog "Could not read remote launcher from origin/buuk."
        }
    } else {
        Write-BootstrapLog "git fetch failed; attempting cached/local launcher fallback."
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

    $powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    $process = Start-Process -FilePath $powerShell -ArgumentList @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", ('"' + $launcherToRun + '"'),
        "-RepoRootOverride", ('"' + $resolvedRepoRoot + '"')
    ) -WindowStyle Hidden -Wait -PassThru

    exit $process.ExitCode
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
