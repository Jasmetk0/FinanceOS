$ErrorActionPreference = "SilentlyContinue"

$dataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "FinanceOS"
} else {
    Join-Path $env:USERPROFILE ".financeos\FinanceOS"
}
$pidFile = Join-Path $dataDir "server.pid"

if (Test-Path $pidFile) {
    $serverPid = [int](Get-Content $pidFile -Raw)
    if ($serverPid -gt 0) {
        & taskkill.exe /PID $serverPid /T /F *> $null
    }
    Remove-Item $pidFile -Force
}

$connections = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
foreach ($connection in $connections) {
    $process = Get-CimInstance Win32_Process -Filter ("ProcessId = " + $connection.OwningProcess)
    if ($process -and $process.CommandLine -match "next|financeos") {
        & taskkill.exe /PID $connection.OwningProcess /T /F *> $null
    }
}
