$terminal = "C:\Program Files (x86)\MetaTrader 4\terminal.exe"
$proc = Get-Process -Name "terminal" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*MetaTrader 4*" }
if ($proc) {
    Write-Host "Stopping MT4 terminal PID $($proc.Id)..."
    $proc | Stop-Process -Force
    Start-Sleep -Seconds 5
}
Write-Host "Starting MT4 terminal..."
Start-Process -FilePath $terminal
