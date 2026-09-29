param(
    [string]$RepoRootOverride = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = if ([string]::IsNullOrWhiteSpace($RepoRootOverride)) {
    (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    (Resolve-Path $RepoRootOverride).Path
}
$gitDir = Join-Path $repoRoot ".git"

if (-not (Test-Path $gitDir)) {
    throw "FinanceOS repository was not found at: $repoRoot"
}

$desktop = [Environment]::GetFolderPath("Desktop")
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path $desktop)) {
    throw "Windows Desktop folder could not be resolved."
}

$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$bootstrapSource = Join-Path $repoRoot "scripts\desktop-bootstrap.ps1"
$stopSource = Join-Path $repoRoot "scripts\stop-financeos.ps1"

if (-not (Test-Path $bootstrapSource) -or -not (Test-Path $stopSource)) {
    throw "FinanceOS launcher scripts are missing. Update the repository and run this installer again."
}

$dataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "FinanceOS"
} else {
    Join-Path $env:USERPROFILE ".financeos\FinanceOS"
}
$launcherDir = Join-Path $dataDir "launcher"
New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null

$localBootstrap = Join-Path $launcherDir "desktop-bootstrap.ps1"
$localStop = Join-Path $launcherDir "stop-financeos.ps1"
Copy-Item $bootstrapSource $localBootstrap -Force
Copy-Item $stopSource $localStop -Force

$shell = New-Object -ComObject WScript.Shell

function New-FinanceShortcut(
    [string]$Path,
    [string]$Script,
    [string]$ExtraArguments,
    [string]$Description,
    [string]$Icon
) {
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $powerShell
    $shortcut.Arguments =
        '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' +
        $Script +
        '"' +
        $ExtraArguments
    $shortcut.WorkingDirectory = $launcherDir
    $shortcut.Description = $Description
    $shortcut.IconLocation = $Icon
    $shortcut.WindowStyle = 7
    $shortcut.Save()
}

$startShortcut = Join-Path $desktop "FinanceOS.lnk"
$stopShortcut = Join-Path $desktop "FinanceOS Stop.lnk"

New-FinanceShortcut $startShortcut $localBootstrap (' -RepoRoot "' + $repoRoot + '"') "Download latest launcher, update and open FinanceOS" "$env:SystemRoot\System32\shell32.dll,167"
New-FinanceShortcut $stopShortcut $localStop "" "Stop the local FinanceOS server" "$env:SystemRoot\System32\shell32.dll,131"

$legacyLauncher = Join-Path $desktop "FinanceOS.cmd"
if (Test-Path $legacyLauncher) {
    Remove-Item $legacyLauncher -Force
}

Write-Host ""
Write-Host "Created desktop shortcuts:"
Write-Host ("  " + $startShortcut)
Write-Host ("  " + $stopShortcut)
Write-Host ""
Write-Host ("Launcher bootstrap: " + $localBootstrap)
Write-Host "The desktop shortcut now downloads the current launcher from origin/buuk before starting FinanceOS."
