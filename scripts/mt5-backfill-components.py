#!/usr/bin/env python3
r"""
MT5 component-candle backfiller (Python fallback).

Connects to a local MT5 terminal, fetches 1-minute rates for configured FX
symbols, and upserts them into candles_1m. Designed as a fallback for symbols
where the chart-attached EA returns ERR_HISTORY_NOT_FOUND (4401).

Run via PM2 with the bridge virtualenv interpreter:
    interpreter: C:\tradzfx-v2\.venv\Scripts\python.exe
    script     : C:\tradzfx-v2\scripts\mt5-backfill-components.py
"""

import atexit
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import MetaTrader5 as mt5
import numpy as np
import psycopg2
from psycopg2.extras import execute_values

_log_file = os.environ.get("MT5_BACKFILL_LOG_FILE", "")
_log_handlers = []
if _log_file:
    os.makedirs(os.path.dirname(_log_file), exist_ok=True)
    _log_handlers.append(logging.FileHandler(_log_file, mode="a", encoding="utf-8"))
# Only add stdout handler when a console is available (pythonw has none).
if sys.stdout is not None and sys.stderr is not None:
    _log_handlers.append(logging.StreamHandler(sys.stdout))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
    handlers=_log_handlers,
)
log = logging.getLogger("mt5-backfill")

DEFAULT_SYMBOLS = "EURUSD,GBPUSD,USDJPY,USDCAD,USDCHF,USDSEK"
STALE_THRESHOLD_MIN = int(os.environ.get("MT5_BACKFILL_STALE_MIN", "3"))
BACKFILL_DAYS = int(os.environ.get("MT5_BACKFILL_DAYS", "30"))
OVERLAP_MIN = int(os.environ.get("MT5_BACKFILL_OVERLAP_MIN", "5"))
BATCH_SIZE = int(os.environ.get("MT5_BACKFILL_BATCH_SIZE", "5000"))

MT5_PATH = os.environ.get("MT5_TERMINAL_PATH", "")
if not MT5_PATH:
    MT5_PATH = "C:\\Program Files\\MetaTrader 5\\terminal64.exe"

HEALTH_STALE_MIN = int(os.environ.get("MT5_BACKFILL_HEALTH_STALE_MIN", "5"))
_MUTEX_NAME = "Global\\tradzfxMT5BackfillMutex"
_g_mutex_handle = None


def acquire_lock() -> bool:
    """Use a Windows named mutex to ensure only one daemon runs."""
    global _g_mutex_handle
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        ERROR_ALREADY_EXISTS = 183
        _g_mutex_handle = kernel32.CreateMutexW(None, 0, _MUTEX_NAME)
        err = kernel32.GetLastError()
        if _g_mutex_handle == 0 or err == ERROR_ALREADY_EXISTS:
            log.warning("Another instance is already running; exiting")
            return False
        return True
    except Exception as e:
        log.warning("Lock check failed: %s; continuing anyway", e)
        return True


def release_lock():
    global _g_mutex_handle
    if _g_mutex_handle:
        try:
            ctypes.windll.kernel32.CloseHandle(_g_mutex_handle)
        except Exception:
            pass
        _g_mutex_handle = None


def health_check(symbols: List[str], broker: str):
    """Log a warning if any component is stale."""
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT symbol, MAX(ts) FROM candles_1m WHERE symbol = ANY(%s) GROUP BY symbol",
            (symbols,),
        )
        rows = {r[0]: r[1] for r in cur.fetchall()}
        cur.close()
        conn.close()
        now = datetime.now(timezone.utc)
        for sym in symbols:
            last = rows.get(sym)
            if last is None:
                log.warning("[health] %s: no candles found", sym)
                continue
            stale_min = (now - last).total_seconds() / 60.0
            if stale_min > HEALTH_STALE_MIN:
                log.warning(
                    "[health] %s is stale by %.1f min (last %s)",
                    sym,
                    stale_min,
                    last,
                )
    except Exception as e:
        log.warning("[health] check failed: %s", e)


def get_db_conn():
    return psycopg2.connect(
        host=os.environ.get("TM_DB_HOST", "localhost"),
        port=int(os.environ.get("TM_DB_PORT", "5432")),
        database=os.environ.get("TM_DB_NAME", (process.env.TM_DB_NAME || "tradzfx_v2")),
        user=os.environ.get("TM_DB_USER", "postgres"),
        password=os.environ.get("TM_DB_PASSWORD", process.env.TM_DB_PASSWORD),
    )


def init_mt5() -> bool:
    path = MT5_PATH if os.path.exists(MT5_PATH) else ""
    if not mt5.initialize(path=path):
        err = mt5.last_error()
        log.error("MT5 initialize failed: %s", err)
        return False
    account = mt5.account_info()
    if account is None:
        log.error("MT5 account_info failed: %s", mt5.last_error())
        mt5.shutdown()
        return False
    log.info(
        "MT5 initialized: login=%s server=%s company=%s",
        account.login,
        account.server,
        account.company,
    )
    return True


def ensure_mt5() -> bool:
    if mt5.terminal_info() is not None:
        return True
    return init_mt5()


def last_ts_for_symbol(cur, symbol: str) -> Optional[datetime]:
    cur.execute(
        "SELECT MAX(ts) FROM candles_1m WHERE symbol = %s",
        (symbol,),
    )
    row = cur.fetchone()
    return row[0] if row and row[0] else None


def rates_to_rows(symbol: str, rates, digits: int, broker: str):
    """Convert an MT5 MqlRates numpy array to DB rows."""
    if rates is None or len(rates) == 0:
        return []
    rows = []
    for r in rates:
        ts_epoch = int(r["time"].astype("int64"))
        ts = datetime.fromtimestamp(ts_epoch, tz=timezone.utc)
        rows.append(
            (
                symbol,
                ts,
                float(r["open"]),
                float(r["high"]),
                float(r["low"]),
                float(r["close"]),
                int(r["tick_volume"]),
                int(r["spread"]) if r["spread"] else None,
                broker,
                digits,
            )
        )
    return rows


def aggregate_ticks_to_minutes(symbol: str, ticks, digits: int, broker: str):
    """Aggregate an MT5 tick numpy array into 1m OHLC rows."""
    if ticks is None or len(ticks) == 0:
        return []
    point = mt5.symbol_info(symbol).point or 1e-5
    # Sort by time
    order = np.argsort(ticks["time"])
    t = ticks[order]
    times = t["time"].astype("int64")
    prices = (t["bid"] + t["ask"]) / 2.0
    minutes = times // 60
    if len(minutes) == 0:
        return []
    changes = np.where(np.diff(minutes) != 0)[0] + 1
    starts = np.concatenate(([0], changes))
    ends = np.concatenate((changes, [len(minutes)]))

    opens = prices[starts]
    highs = np.maximum.reduceat(prices, starts)
    lows = np.minimum.reduceat(prices, starts)
    closes = prices[ends - 1]
    volumes = np.add.reduceat(t["volume"], starts)
    spreads_pts = np.add.reduceat((t["ask"] - t["bid"]) / point, starts)
    spread_counts = ends - starts
    avg_spreads = (spreads_pts / spread_counts).astype(np.int64)

    rows = []
    for i in range(len(starts)):
        ts = datetime.fromtimestamp(int(minutes[starts[i]] * 60), tz=timezone.utc)
        # Use tick count as volume if trade volume is zero
        vol = int(volumes[i]) if int(volumes[i]) > 0 else int(spread_counts[i])
        rows.append(
            (
                symbol,
                ts,
                float(opens[i]),
                float(highs[i]),
                float(lows[i]),
                float(closes[i]),
                vol,
                int(avg_spreads[i]),
                broker,
                digits,
            )
        )
    return rows


def fetch_and_insert_symbol(symbol: str, cur, conn, broker: str) -> int:
    if not mt5.symbol_select(symbol, True):
        log.warning("%s: SymbolSelect failed, skipping", symbol)
        return 0

    info = mt5.symbol_info(symbol)
    if info is None:
        log.warning("%s: symbol_info failed, skipping", symbol)
        return 0
    digits = int(info.digits)

    now_utc = datetime.now(timezone.utc)
    max_ts = last_ts_for_symbol(cur, symbol)

    if max_ts is None:
        start_utc = now_utc - timedelta(days=BACKFILL_DAYS)
        log.info("%s: no existing rows; backfilling %d days", symbol, BACKFILL_DAYS)
    else:
        stale_min = (now_utc - max_ts).total_seconds() / 60.0
        if stale_min < STALE_THRESHOLD_MIN:
            log.info("%s: fresh (last %s), skipping", symbol, max_ts)
            return 0
        start_utc = max_ts - timedelta(minutes=OVERLAP_MIN)
        log.info(
            "%s: stale by %.1f min; fetching from %s to %s",
            symbol,
            stale_min,
            start_utc,
            now_utc,
        )

    if (now_utc - start_utc).total_seconds() < 30:
        log.info("%s: window too small, skipping", symbol)
        return 0

    rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, start_utc, now_utc)
    if rates is not None and len(rates) > 0:
        rows = rates_to_rows(symbol, rates, digits, broker)
        log.info("%s: CopyRates returned %d bars", symbol, len(rows))
    else:
        err = mt5.last_error()
        log.warning("%s: CopyRates failed/err=%s; falling back to tick aggregation", symbol, err)
        # Limit tick fallback to a manageable recent window.
        tick_from = now_utc - timedelta(hours=6)
        ticks = mt5.copy_ticks_range(symbol, tick_from, now_utc, mt5.COPY_TICKS_ALL)
        rows = aggregate_ticks_to_minutes(symbol, ticks, digits, broker)
        log.info("%s: tick aggregation returned %d bars", symbol, len(rows))

    if not rows:
        return 0

    inserted = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        execute_values(
            cur,
            """
            INSERT INTO candles_1m (symbol, ts, o, h, l, c, v, spread, broker, digits)
            VALUES %s
            ON CONFLICT (symbol, ts) DO NOTHING
            """,
            batch,
        )
        conn.commit()
        inserted += cur.rowcount

    log.info("%s: inserted %d new rows", symbol, inserted)
    return inserted


def run_once(symbols: List[str], broker: str) -> int:
    conn = get_db_conn()
    total = 0
    try:
        cur = conn.cursor()
        for symbol in symbols:
            try:
                total += fetch_and_insert_symbol(symbol, cur, conn, broker)
            except Exception as e:
                log.exception("%s: failed to backfill: %s", symbol, e)
        cur.close()
        log.info("Total rows inserted: %d", total)
    finally:
        conn.close()
    return total


def main():
    symbols_raw = os.environ.get("MT5_SYMBOLS", DEFAULT_SYMBOLS)
    symbols = [s.strip().upper() for s in symbols_raw.split(",") if s.strip()]
    log.info("Starting backfill for symbols: %s", symbols)

    if not init_mt5():
        sys.exit(1)

    account = mt5.account_info()
    broker = account.company if account and account.company else "mt5-python"

    try:
        run_once(symbols, broker)
    finally:
        mt5.shutdown()


def daemon():
    if not acquire_lock():
        sys.exit(0)
    atexit.register(release_lock)

    symbols_raw = os.environ.get("MT5_SYMBOLS", DEFAULT_SYMBOLS)
    symbols = [s.strip().upper() for s in symbols_raw.split(",") if s.strip()]
    log.info("Daemon starting for symbols: %s", symbols)

    broker = "mt5-python"
    while True:
        try:
            if not ensure_mt5():
                log.error("MT5 not available; retrying in 60s")
                time.sleep(60)
                continue

            account = mt5.account_info()
            if account and account.company:
                broker = account.company

            run_once(symbols, broker)
            health_check(symbols, broker)
        except Exception as e:
            log.exception("Daemon tick failed: %s", e)

        log.info("Sleeping 60s...")
        time.sleep(60)


if __name__ == "__main__":
    if os.environ.get("MT5_BACKFILL_RUN_ONCE", "").lower() in ("1", "true", "yes"):
        try:
            main()
        except Exception as e:
            log.exception("Run failed: %s", e)
            sys.exit(1)
    else:
        daemon()
