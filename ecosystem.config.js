module.exports = {
  apps: [
    {
      name: 'tm-web-v2',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3003',
      cwd: 'C:\\TradeMentor\\v2\\apps\\web',
      instances: 1,
      exec_mode: 'fork',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: '3003',
        TM_DB_HOST: 'localhost',
        TM_DB_PORT: '5432',
        TM_DB_NAME: 'tradementor_v2',
        TM_DB_USER: 'postgres',
        TM_DB_PASSWORD: '2k16Dub@i',
        TM_DB_POOL_MAX: '20',
        // Kill runaway queries from the web app at the DB level.
        // (The backfill/engine processes intentionally do NOT set this.)
        TM_DB_STATEMENT_TIMEOUT: '60000',
        // Keep the same MT5 EA key the code currently falls back to.
        TM_MT5_API_KEY: 'tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef',
        NODE_OPTIONS: '--max-old-space-size=4096',
      },
      error_file: 'C:\\TradeMentor\\v2\\logs\\pm2-web-error.log',
      out_file: 'C:\\TradeMentor\\v2\\logs\\pm2-web-out.log',
      log_file: 'C:\\TradeMentor\\v2\\logs\\pm2-web-combined.log',
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
  ],
};
