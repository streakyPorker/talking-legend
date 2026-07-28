import * as fs from 'fs';
import * as path from 'path';

export function appendNarrative(gameDataDir: string, gameId: string, text: string): void {
  const dir = path.join(gameDataDir, gameId);
  fs.mkdirSync(dir, { recursive: true });
  // 替换换行为空格，确保每条叙事一行，避免多段叙事破坏按行截取
  const sanitized = text.replace(/\n/g, ' ');
  fs.appendFileSync(path.join(dir, 'narrative.log'), sanitized + '\n', 'utf-8');
}

export function readNarrative(gameDataDir: string, gameId: string): string {
  const file = path.join(gameDataDir, gameId, 'narrative.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
}
