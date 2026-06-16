module.exports = {
  apps: [
    {
      name: "tradzfx-v2-web",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3002",
      cwd: "C:/tradzfx-v2/apps/web",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
        TM_DB_HOST: "localhost",
        TM_DB_PORT: "5432",
        TM_DB_NAME: "tradementor_v2",
        TM_DB_USER: "postgres",
        TM_DB_PASSWORD: "2k16Dub@i",
        TM_DB_POOL_MAX: "20",
        TM_DB_STATEMENT_TIMEOUT: "60000",
        TM_MT5_API_KEY: "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef",
      },
      log_file: "C:/tradzfx-v2/logs/pm2-web-combined.log",
      out_file: "C:/tradzfx-v2/logs/pm2-web-out.log",
      error_file: "C:/tradzfx-v2/logs/pm2-web-error.log",
      merge_logs: true,
    },
  ],
};
