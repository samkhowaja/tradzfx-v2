#requires -Version 5.1
<#
.SYNOPSIS
  Shared alerting helper for operational scripts.

.DESCRIPTION
  Sends a message to Telegram if NOTIFY_ENABLED=true and the Telegram
  bot token/chat ID are configured. Falls back to console output and the
  Windows event log if Telegram is not configured.
#>

function Send-OpsAlert {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,

        [ValidateSet('Info', 'Warning', 'Error')]
        [string]$Level = 'Warning'
    )

    $timestamp = (Get-Date).ToString('o')
    $fullMessage = "[$Level] $timestamp`n$Message"

    # Console
    switch ($Level) {
        'Info'    { Write-Host $fullMessage -ForegroundColor Green }
        'Warning' { Write-Host $fullMessage -ForegroundColor Yellow }
        'Error'   { Write-Host $fullMessage -ForegroundColor Red }
    }

    # Telegram
    $enabled = [Environment]::GetEnvironmentVariable('NOTIFY_ENABLED')
    $botToken = [Environment]::GetEnvironmentVariable('NOTIFY_TELEGRAM_BOT_TOKEN')
    $chatId = [Environment]::GetEnvironmentVariable('NOTIFY_TELEGRAM_CHAT_ID')

    if ($enabled -eq 'true' -and $botToken -and $chatId) {
        try {
            $body = @{
                chat_id = $chatId
                text    = $fullMessage
                parse_mode = 'Markdown'
            } | ConvertTo-Json -Compress

            $uri = "https://api.telegram.org/bot$botToken/sendMessage"
            Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body $body | Out-Null
        } catch {
            Write-Warning "Failed to send Telegram alert: $_"
        }
    }
}

