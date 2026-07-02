# Register the MT5 Python backfiller as a scheduled task.
# Runs at user logon and restarts every minute if the process dies.
$taskName = 'tradzfx MT5 Backfill'
$scriptPath = 'C:\tradzfx-v2\scripts\start-mt5-python-backfill.ps1'

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`""

# Start once now (or at logon) and repeat every minute for 10 years.
$start = (Get-Date).AddMinutes(1).ToString('HH:mm')
$trigger = New-ScheduledTaskTrigger `
    -Once -At $start `
    -RepetitionInterval (New-TimeSpan -Minutes 1) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType Interactive `
    -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -Hidden `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Force

Write-Host "Scheduled task '$taskName' registered for user $env:USERNAME."
