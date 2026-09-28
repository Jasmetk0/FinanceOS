$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gitDir = Join-Path $repoRoot ".git"

if (-not (Test-Path $gitDir)) {
    throw "FinanceOS repository was not found at: $repoRoot"
}

$desktop = [Environment]::GetFolderPath("Desktop")
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path $desktop)) {
    throw "Windows Desktop folder could not be resolved."
}

$powerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$startScript = Join-Path $repoRoot "scripts\start-financeos.ps1"
$stopScript = Join-Path $repoRoot "scripts\stop-financeos.ps1"

if (-not (Test-Path $startScript) -or -not (Test-Path $stopScript)) {
    throw "FinanceOS launcher scripts are missing. Update the repository and run this installer again."
}

$shell = New-Object -ComObject WScript.Shell

function New-FinanceShortcut([string]$Path, [string]$Script, [string]$Description, [string]$Icon) {
    $shortcut = $shell.CreateShortcut($Path)
    $shortcut.TargetPath = $powerShell
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $Script + '"'
    $shortcut.WorkingDirectory = $repoRoot
    $shortcut.Description = $Description
    $shortcut.IconLocation = $Icon
    $shortcut.WindowStyle = 7
    $shortcut.Save()
}

$startShortcut = Join-Path $desktop "FinanceOS.lnk"
$stopShortcut = Join-Path $desktop "FinanceOS Stop.lnk"

New-FinanceShortcut $startShortcut $startScript "Update and open FinanceOS" "$env:SystemRoot\System32\shell32.dll,167"
New-FinanceShortcut $stopShortcut $stopScript "Stop the local FinanceOS server" "$env:SystemRoot\System32\shell32.dll,131"

$legacyLauncher = Join-Path $desktop "FinanceOS.cmd"
if (Test-Path $legacyLauncher) {
    Remove-Item $legacyLauncher -Force
}

Write-Host ""
Write-Host "Created desktop shortcuts:"
Write-Host ("  " + $startShortcut)
Write-Host ("  " + $stopShortcut)
Write-Host ""
Write-Host "FinanceOS now runs without a permanent terminal window."
