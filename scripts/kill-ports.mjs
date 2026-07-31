/**
 * Stop legend: kill PID from legend.pid, then clean ports.
 * Usage: node scripts/kill-ports.mjs [port1 port2...]
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { platform } from 'os';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const PID_FILE = join(ROOT, 'backend', 'data', 'legend.pid');
const isWin = platform() === 'win32';
// Windows 下 execSync 在 cmd.exe 里跑，taskkill 必须用单斜杠 /F /PID；
// //F 是 git-bash 风格转义，传给 cmd 会因参数非法而静默失败（"Stopped 0"）。
const killCmd = isWin ? 'taskkill /F /PID' : 'kill -9';

let killed = 0;

// ── 1. Kill PID from legend.pid ──
if (existsSync(PID_FILE)) {
  const pid = readFileSync(PID_FILE, 'utf8').trim();
  try {
    execSync(`${killCmd} ${pid}`, { stdio: 'ignore' });
    console.log(`Killed legend PID ${pid}`);
    killed++;
  } catch { /* already dead */ }
  try { rmSync(PID_FILE, { force: true }); } catch {}
}

// ── 2. Kill remaining processes on given ports ──
const ports = process.argv.slice(2);
for (const port of ports) {
  try {
    const filter = isWin
      ? `netstat -ano | findstr ":${port} " | findstr "LISTENING"`
      : `netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING`;
    const result = execSync(filter, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: isWin ? 'cmd.exe' : '/bin/bash',
    });
    const lines = result.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid)) {
        try {
          execSync(`${killCmd} ${pid}`, { stdio: 'ignore' });
          console.log(`Killed PID ${pid} (port ${port})`);
          killed++;
        } catch { /* already dead */ }
      }
    }
  } catch { /* port not in use */ }
}
console.log(`Stopped ${killed} process(es).`);