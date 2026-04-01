module.exports = {
  apps: [
    {
      name: '2',
      script: './2.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',  // 内存超过 300MB 自动重启
      cron_restart: '0 4 * * *',   // 每天凌晨 4 点重启
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=512',  // 最大堆内存 512MB
      env: {
        NODE_ENV: 'production'
      },
      error_file: '~/.pm2/logs/2-error.log',
      out_file: '~/.pm2/logs/2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: '78-sse-2',
      script: './78-sse-2.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=1024',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: '78-sse-21',
      script: './78-sse-21.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '500M',  // 当前进程使用 430MB，设置 500MB 限制
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=1024 --gc-interval=100',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: '78-sse-22',
      script: './78-sse-22.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1500M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=4096',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: '78-sse-r1',
      script: './78-sse-r1.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '400M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=1024',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: '78-sse-r2',
      script: './78-sse-r2.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: '78-sse-r3',
      script: './78-sse-r3.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: '78-sse-r4',
      script: './78-sse-r4.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: '78-sse-r5',
      script: './78-sse-r5.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'speech-translate',
      script: './speech-translate.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '200M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s',
      restart_delay: 3000,
      watch: false,
      node_args: '--max-old-space-size=256',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'mp-auto-push-api',
      script: '/var/www/mp-auto-push/src/apiServer.js',
      cwd: '/var/www/mp-auto-push',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      cron_restart: '0 4 * * *',
      autorestart: true,
      watch: false,
      node_args: '--max-old-space-size=512',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
