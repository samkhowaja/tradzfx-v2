@echo off
set MT5_BACKFILL_LOG_FILE=C:\tradzfx-v2\logs\mt5-python-backfill.log
set MT5_SYMBOLS=EURUSD,GBPUSD,USDJPY,USDCAD,USDCHF,USDSEK
"C:\TradeMentor\bridge\.venv\Scripts\pythonw.exe" "C:\tradzfx-v2\scripts\mt5-backfill-components.py"
