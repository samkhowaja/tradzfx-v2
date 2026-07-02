$env:MT5_BACKFILL_LOG_FILE = 'C:\tradzfx-v2\logs\mt5-python-backfill.log'
$env:MT5_SYMBOLS = 'EURUSD,GBPUSD,USDJPY,USDCAD,USDCHF,USDSEK'
Start-Process -FilePath 'C:\tradzfx-v2\.venv\Scripts\python.exe' `
    -ArgumentList 'C:\tradzfx-v2\scripts\mt5-backfill-components.py' `
    -WindowStyle Hidden -WorkingDirectory 'C:\tradzfx-v2'
