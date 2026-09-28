$ErrorActionPreference = "Continue"

$dataDir = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA "FinanceOS"
} else {
    Join-Path $env:USERPROFILE ".financeos\FinanceOS"
}
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$logPath = Join-Path $dataDir "background-sync.log"
$healthUrl = "http://127.0.0.1:3000/api/health"
$syncUrl = "http://127.0.0.1:3000/api/sync"
$intervalSeconds = 15 * 60

function Write-SyncLog([string]$Message) {
    $line = "{0:u} {1}" -f (Get-Date), $Message
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

Write-SyncLog "Background sync worker started."

while ($true) {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 5
        if ($health.ok -eq $true -and $health.app -eq "FinanceOS") {
            Write-SyncLog "Starting scheduled sync."
            $result = Invoke-RestMethod -Uri $syncUrl -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 600

            if ($result.ok -eq $true) {
                Write-SyncLog "Scheduled sync completed."
            } else {
                Write-SyncLog "Scheduled sync completed with provider errors."
            }
        } else {
            Write-SyncLog "Health check returned an unexpected response."
        }
    } catch {
        Write-SyncLog ("Sync attempt failed: " + $_.Exception.Message)
    }

    Start-Sleep -Seconds $intervalSeconds
}
