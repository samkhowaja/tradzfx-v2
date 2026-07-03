module.exports = {
  apps: [
    {
      name: 'tz-web-v2',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3003',
      cwd: 'C:\\tradzfx-v2\\apps\\web',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '3003',
        TM_DB_HOST: 'localhost',
        TM_DB_PORT: '5432',
        TM_DB_NAME: 'tradzfx_v2',
        TM_DB_USER: 'postgres',
        TM_DB_PASSWORD: process.env.TM_DB_PASSWORD,
        TM_DB_POOL_MAX: '20',
        TM_DB_STATEMENT_TIMEOUT: '60000',
        TM_MT5_API_KEY: process.env.TM_MT5_API_KEY,
        MT5_SYMBOLS: 'EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,USDSEK,AUDUSD,NZDUSD,XAUUSD',
        TM_DISABLE_FEATURE_JOBS: 'true',
        NINJA_LIVE_ENABLED: 'false',
        NINJA_LIVE_MODE: 'paper',
        NINJA_SYMBOLS: 'XAUUSD',
        NINJA_LOT_SIZE: '0.01',
        // Small-account safety guard: cap any risk-based lot calculation at 1 lot
        // and allow only one concurrent position total (and one per symbol).
        MAX_LOT_PER_ORDER: '1.0',
        SMALL_ACCOUNT_MAX_TOTAL: '1',
        SMALL_ACCOUNT_MAX_PER_SYMBOL: '1',
        SMALL_ACCOUNT_COOLDOWN_MINUTES: '30',
        SMALL_ACCOUNT_MAX_DAILY_LOSS_PCT: '5',
        NODE_OPTIONS: '--max-old-space-size=4096',
      },
      error_file: 'C:\\tradzfx-v2\\logs\\pm2-web-error.log',
      out_file: 'C:\\tradzfx-v2\\logs\\pm2-web-out.log',
      log_file: 'C:\\tradzfx-v2\\logs\\pm2-web-combined.log',
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '5000M',
      kill_timeout: 5000,
      listen_timeout: 3000,
      shutdown_with_message: true,
      watch: false,
    },
    // NOTE: tm-web-v2-ninja-trail removed because scripts/run-ninja-trail-cron.ts
    // does not exist and PM2 on Windows cannot execute node_modules/.bin/tsx.cmd.
    // Re-add as a compiled JS entry if the cron is revived.
    {
      name: 'tz-dxy-synthetic',
      script: 'C:\\tradzfx-v2\\scripts\\run-dxy-synthetic-cron.js',
      cwd: 'C:\\tradzfx-v2',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        TM_DB_HOST: 'localhost',
        TM_DB_PORT: '5432',
        TM_DB_NAME: 'tradzfx_v2',
        TM_DB_USER: 'postgres',
        TM_DB_PASSWORD: process.env.TM_DB_PASSWORD,
        TM_DB_POOL_MAX: '2',
      },
      error_file: 'C:\\tradzfx-v2\\logs\\pm2-dxy-synthetic-error.log',
      out_file: 'C:\\tradzfx-v2\\logs\\pm2-dxy-synthetic-out.log',
      log_file: 'C:\\tradzfx-v2\\logs\\pm2-dxy-synthetic-combined.log',
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      watch: false,
    },
    // NOTE: tm-mt5-python-backfill is intentionally not managed by PM2 because
    // MetaTrader5's Python API must run in the same interactive Windows session
    // as the MT5 terminal (RDP session 3). It is started via
    // scripts/run-mt5-python-backfill.bat in that session.
  ],
};
