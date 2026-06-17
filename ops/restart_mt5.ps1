$terminal = "C:\Program Files\MetaTrader 5\terminal64.exe"
$proc = Get-Process -Name "terminal64" -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*MetaTrader 5*" }
if ($proc) {
    Write-Host "Stopping MT5 terminal PID $($proc.Id)..."
    $proc | Stop-Process -Force
    Start-Sleep -Seconds 5
}
Write-Host "Starting MT5 terminal..."
Start-Process -FilePath $terminal
