#!/usr/bin/env node

const { execSync } = require('child_process');

/**
 * 获取 PM2 管理的所有进程
 */
function getPM2Processes() {
  try {
    const output = execSync('pm2 jlist', { encoding: 'utf8' });
    return JSON.parse(output);
  } catch (error) {
    console.error('获取 PM2 进程列表失败:', error.message);
    return [];
  }
}

/**
 * 获取指定 PID 监听的端口
 */
function getPortsByPid(pid) {
  try {
    // 使用 netstat 或 ss 命令获取端口信息
    // -nltp: n=numeric, l=listening, t=tcp, p=program
    const output = execSync(`netstat -nltp 2>/dev/null | grep ${pid} || true`, {
      encoding: 'utf8'
    });

    const ports = [];
    const lines = output.trim().split('\n').filter(line => line);

    for (const line of lines) {
      // 解析 netstat 输出
      // tcp        0      0 0.0.0.0:3000            0.0.0.0:*               LISTEN      12345/node
      const match = line.match(/:(\d+)\s+.*\s+LISTEN/);
      if (match) {
        ports.push(match[1]);
      }
    }

    return [...new Set(ports)]; // 去重
  } catch (error) {
    return [];
  }
}

/**
 * 格式化输出
 */
function displayResults(processes) {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                      PM2 进程端口监听情况                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // 按 PM2 ID 排序
  processes.sort((a, b) => a.pm_id - b.pm_id);

  // 计算列宽
  const maxNameLen = Math.max(...processes.map(p => p.name.length), 4);
  const maxPidLen = Math.max(...processes.map(p => String(p.pid).length), 3);

  // 打印表头
  console.log(
    'ID'.padEnd(4) +
    'Name'.padEnd(maxNameLen + 2) +
    'PID'.padEnd(maxPidLen + 2) +
    'Status'.padEnd(10) +
    'Ports'
  );
  console.log('─'.repeat(80));

  // 打印每个进程
  for (const proc of processes) {
    const ports = getPortsByPid(proc.pid);
    const portsStr = ports.length > 0 ? ports.join(', ') : '-';

    console.log(
      String(proc.pm_id).padEnd(4) +
      proc.name.padEnd(maxNameLen + 2) +
      String(proc.pid).padEnd(maxPidLen + 2) +
      proc.status.padEnd(10) +
      portsStr
    );
  }

  console.log('\n');
}

/**
 * 主函数
 */
function main() {
  const processes = getPM2Processes();

  if (processes.length === 0) {
    console.log('没有找到 PM2 管理的进程');
    return;
  }

  // 只处理在线的进程
  const onlineProcesses = processes.filter(p => p.pm2_env.status === 'online');

  if (onlineProcesses.length === 0) {
    console.log('没有在线的 PM2 进程');
    return;
  }

  // 准备数据
  const processData = onlineProcesses.map(p => ({
    pm_id: p.pm2_env.pm_id,
    name: p.name,
    pid: p.pid,
    status: p.pm2_env.status
  }));

  displayResults(processData);
}

// 运行
main();
