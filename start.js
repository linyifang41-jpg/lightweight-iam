// 统一启动脚本 - 一键启动 IAM 认证中心 + 两个关联应用
const { spawn } = require('child_process');
const path = require('path');

const processes = [];

function start(name, file, port) {
  const child = spawn(process.execPath, [file], {
    cwd: path.join(__dirname, '.'),
    env: { ...process.env, PORT: String(port) },
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (d) => {
    process.stdout.write(`[${name}] ${d}`);
  });
  child.stderr.on('data', (d) => {
    process.stderr.write(`[${name}] ${d}`);
  });
  child.on('exit', (code) => {
    console.log(`[${name}] 已退出 (code=${code})`);
  });

  processes.push(child);
  return child;
}

console.log('🚀 启动 IAM 单点登录系统...\n');

start('IAM ', path.join('src', 'index.js'), process.env.IAM_PORT || 8080);
start('应用A', path.join('apps', 'appA.js'), process.env.APP_A_PORT || 8081);
start('应用B', path.join('apps', 'appB.js'), process.env.APP_B_PORT || 8082);

console.log('\n服务启动中...');
console.log('  IAM 认证中心:  http://localhost:8080');
console.log('  应用A 员工门户: http://localhost:8081');
console.log('  应用B 项目管理: http://localhost:8082');

// 优雅退出
function shutdown() {
  console.log('\n正在停止所有服务...');
  for (const p of processes) {
    try { p.kill('SIGTERM'); } catch (e) {}
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);