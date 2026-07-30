import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Custom logger: dev → console + file, prod → file only.
 * Detects dev mode via NODE_ENV=development or npm_lifecycle_event=dev.
 */
export class LegendLogger extends ConsoleLogger {
  private readonly logFile: string;
  private readonly isDev: boolean;
  // dev: verbose+debug+log+warn+error, prod: log+warn+error
  private readonly levels: Set<string>;

  constructor(context?: string) {
    super(context ?? 'Legend');
    this.isDev =
      process.env.NODE_ENV === 'development' ||
      process.env.npm_lifecycle_event?.includes('dev') ||
      false;
    this.levels = new Set(
      this.isDev
        ? ['verbose', 'debug', 'log', 'warn', 'error']
        : ['log', 'warn', 'error'],
    );

    const logDir = join(process.cwd(), 'data', 'logs');
    if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
    this.logFile = join(logDir, 'legend.log');
  }

  private writeFile(level: string, message: string, trace?: string) {
    const ts = new Date().toISOString();
    const ctx = this.context ? `[${this.context}] ` : '';
    const line = `${ts} ${level.toUpperCase().padEnd(5)} ${ctx}${message}${trace ? '\n' + trace : ''}\n`;
    try {
      appendFileSync(this.logFile, line, 'utf-8');
    } catch { /* 静默 — 日志写入失败不阻断业务 */ }
  }

  private enabled(level: string): boolean {
    return this.levels.has(level);
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    const msg = this.stringify(message, ...optionalParams);
    this.writeFile('log', msg);
    if (this.isDev && this.enabled('log')) super.log(msg);
  }

  error(message: unknown, trace?: string, ...optionalParams: unknown[]) {
    const msg = this.stringify(message, ...optionalParams);
    this.writeFile('error', msg, trace);
    if (this.isDev && this.enabled('error')) super.error(msg, trace);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    const msg = this.stringify(message, ...optionalParams);
    this.writeFile('warn', msg);
    if (this.isDev && this.enabled('warn')) super.warn(msg);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    const msg = this.stringify(message, ...optionalParams);
    this.writeFile('debug', msg);
    if (this.isDev && this.enabled('debug')) super.debug(msg);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    const msg = this.stringify(message, ...optionalParams);
    this.writeFile('verbose', msg);
    if (this.isDev && this.enabled('verbose')) super.verbose(msg);
  }

  private stringify(message: unknown, ...optionalParams: unknown[]): string {
    try {
      const parts = [typeof message === 'string' ? message : JSON.stringify(message)];
      for (const p of optionalParams) {
        if (p !== undefined) parts.push(typeof p === 'string' ? p : JSON.stringify(p));
      }
      return parts.join(' ');
    } catch {
      return String(message);
    }
  }
}
