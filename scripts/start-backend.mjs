/**
 * Start backend, save PID to legend.pid.
 * Usage: node scripts/start-backend.mjs [--clean]
 */
import { spawn } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const PID_FILE = join(ROOT, 'backend', 'data', 'legend.pid');

// --clean: remove old DB before start
if (process.argv.includes('--clean')) {
  try { rmSync(join(ROOT, 'backend', 'data', 'talking-legend.db'), { force: true }); } catch {}
}

// 用 process.execPath 直接 spawn node，避免 shell:true 使 proc.pid 指向 cmd shell
// 而非真实 node 进程（否则写进 legend.pid 的 PID 杀不到监听端口的进程）。
const proc = spawn(process.execPath, ['dist/main.js'], {
  cwd: join(ROOT, 'backend'),
  stdio: 'inherit',
});

writeFileSync(PID_FILE, String(proc.pid));
console.log(`[legend] backend PID ${proc.pid} → ${PID_FILE}`);

proc.on('exit', (code) => {
  console.log(`[legend] backend exited (${code})`);
  try { rmSync(PID_FILE, { force: true }); } catch {}
  process.exit(code ?? 0);
});

// Forward signals
['SIGINT', 'SIGTERM'].forEach((sig) =>
  process.on(sig, () => { proc.kill(sig); })
);