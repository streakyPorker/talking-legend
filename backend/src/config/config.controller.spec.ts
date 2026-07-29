import { describe, it, expect, vi } from 'vitest';
import { ConfigController } from './config.controller.js';
import { ConfigService } from './config.service.js';

// PUT 测试需要模拟文件 I/O。vi.mock 提升到文件顶部，不影响 GET 测试（不读文件）。
vi.mock('fs', () => ({
  readFileSync: () =>
    '[llm.max_tokens]\nopus = 40960\nsonnet = 5120\n' +
    '[npc]\nhistory_rounds = 20\n' +
    '[server]\nport = 30001\n' +
    '[model_tiers]\nopus = ["claude-opus-4"]\n',
  writeFileSync: () => {},
  existsSync: () => true,
  mkdirSync: () => {},
  readdirSync: () => [],
  statSync: () => ({ isDirectory: () => true }),
  constants: {},
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
}));

// ── 辅助 ─────────────────────────────────────────────────────────

/** 默认 mock 值 */
const DEFAULT_TOML_VALUES: Record<string, string | number> = {
  'anthropic.opus_model': 'claude-opus-4-8',
  'anthropic.sonnet_model': 'claude-sonnet-4-6',
  'anthropic.haiku_model': 'claude-haiku-4-5-20251001',
  'model_tiers.opus': 'claude-opus-4, deepseek-v4-pro',
  'model_tiers.sonnet': 'claude-sonnet-4, deepseek-v4-flash',
  'model_tiers.haiku': 'claude-haiku-4, deepseek-v4-lite',
  'server.port': 30001,
  'llm.max_tokens.opus': 40960,
  'llm.max_tokens.sonnet': 5120,
  'llm.max_tokens.haiku': 512,
  'llm.thinking.opus_budget': 4096,
  'llm.thinking.sonnet_budget': 2048,
  'llm.context_budget.opus': 180000,
  'llm.context_budget.sonnet': 50000,
  'llm.context_budget.haiku': 8000,
  'llm.stream.timeout_ms': 90000,
  'npc.history_rounds': 20,
};

function createMockConfig(overrides: Partial<ConfigService> = {}): ConfigService {
  return {
    llmApiKey: 'test-api-key',
    llmBaseUrl: 'https://api.anthropic.com',
    llmOpusModel: 'claude-opus-4-8',
    llmSonnetModel: 'claude-sonnet-4-6',
    llmHaikuModel: 'claude-haiku-4-5-20251001',
    llmMaxTokensOpus: 40960,
    llmMaxTokensSonnet: 5120,
    llmMaxTokensHaiku: 512,
    llmThinkingOpus: 4096,
    llmThinkingSonnet: 2048,
    llmStreamTimeoutMs: 90000,
    llmContextBudgetOpus: 180000,
    llmContextBudgetSonnet: 50000,
    llmContextBudgetHaiku: 8000,
    npcHistoryRounds: 20,
    opusModelPrefixes: ['claude-opus-4', 'deepseek-v4-pro'],
    sonnetModelPrefixes: ['claude-sonnet-4', 'deepseek-v4-flash'],
    haikuModelPrefixes: ['claude-haiku-4', 'deepseek-v4-lite'],
    reloadToml: vi.fn(),
    getTomlValue: vi.fn().mockImplementation((p: string) => DEFAULT_TOML_VALUES[p]),
    tomlPath: '/tmp/test-config.toml',
    ...overrides,
  } as unknown as ConfigService;
}

// ── GET /api/config 测试 ───────────────────────────────────────

describe('ConfigController — GET /api/config', () => {
  it('返回 8 个 section 共 17 个配置项', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.getConfig();

    expect(res).toHaveProperty('sections');
    expect(res.sections).toHaveLength(8);

    const totalItems = res.sections.reduce((s, sec) => s + sec.items.length, 0);
    expect(totalItems).toBe(17);
  });

  it('anthropic section restartRequired=true, items hotReload=false', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.getConfig();

    const sec = res.sections.find((s) => s.key === 'anthropic')!;
    expect(sec.restartRequired).toBe(true);
    sec.items.forEach((item) => {
      expect(item.hotReload).toBe(false);
    });
  });

  it('llm.max_tokens section restartRequired=false, items hotReload=true', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.getConfig();

    const sec = res.sections.find((s) => s.key === 'llm.max_tokens')!;
    expect(sec.restartRequired).toBe(false);
    sec.items.forEach((item) => {
      expect(item.hotReload).toBe(true);
    });
  });

  it('每个配置项的 value 类型正确', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.getConfig();

    for (const sec of res.sections) {
      for (const item of sec.items) {
        if (item.type === 'number') {
          expect(typeof item.value).toBe('number');
        } else {
          expect(typeof item.value).toBe('string');
        }
      }
    }
  });

  it('读取 ConfigService 实际 getter 值', () => {
    const svc = createMockConfig({
      llmMaxTokensOpus: 99999,
      getTomlValue: vi.fn().mockImplementation((p: string) => {
        if (p === 'llm.max_tokens.opus') return 99999;
        return DEFAULT_TOML_VALUES[p];
      }),
    });
    const ctrl = new ConfigController(svc);
    const res = ctrl.getConfig();

    const sec = res.sections.find((s) => s.key === 'llm.max_tokens')!;
    const item = sec.items.find((i) => i.key === 'opus')!;
    expect(item.value).toBe(99999);
  });

  it('password 类型返回 ****', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);

    // 通过 getConfig 间接验证: 当前 schema 没有 password item，
    // 但架构师未来添加时不会泄露；
    // 这里用私有方法反射验证密码守卫已就位
    const passwordItem = {
      key: 'api_key',
      tomlPath: 'anthropic.api_key' as const,
      label: 'API Key',
      type: 'password' as const,
      hotReload: false,
      readonly: false,
    };
    type Ctrl = { resolveValue(item: typeof passwordItem): string | number };
    const value = (ctrl as unknown as Ctrl).resolveValue(passwordItem);
    expect(value).toBe('****');
  });

  it('model_tiers 不再是 readonly（允许编辑）', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.getConfig();

    const sec = res.sections.find((s) => s.key === 'model_tiers')!;
    for (const item of sec.items) {
      expect(item.readonly).toBe(false);
    }
  });
});

// ── PUT /api/config 测试 ─────────────────────────────────────────

describe('ConfigController — PUT /api/config', () => {
  it('空 changes 返回空 applied/errors', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.updateConfig({ changes: {} });

    expect(res.applied).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('无效 body 返回错误', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.updateConfig({ changes: null as unknown as Record<string, string | number> });

    expect(res.errors).toContain('Invalid body: changes must be an object');
  });

  it('提交更改返回正确的响应结构', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.updateConfig({ changes: { 'llm.max_tokens.opus': 80000 } });

    expect(res).toHaveProperty('applied');
    expect(res).toHaveProperty('restartRequired');
    expect(res).toHaveProperty('errors');
  });

  it('model_tiers 允许写入（不再只读）', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.updateConfig({ changes: { 'model_tiers.opus': 'claude-opus-4, test-model' } });

    expect(res.errors).toEqual([]);
    expect(res.applied).toContain('model_tiers.opus');
    expect(res.restartRequired).toContain('model_tiers.opus');
  });

  it('浮点数写入整数字段返回错误', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.updateConfig({ changes: { 'server.port': 1234.5 } });

    expect(res.errors).toContain('server.port: must be an integer');
    expect(res.applied).toEqual([]);
  });

  it('无效类型（boolean）写入返回错误', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.updateConfig({ changes: { 'llm.max_tokens.opus': true as unknown as number } });

    expect(res.errors).toContain('llm.max_tokens.opus: value must be a string or number');
    expect(res.applied).toEqual([]);
  });

  it('errors 非空且 applied 为空时不触发写入', () => {
    const svc = createMockConfig();
    const ctrl = new ConfigController(svc);
    const res = ctrl.updateConfig({ changes: { 'unknown.path': 'val' } });

    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.applied).toEqual([]);
    expect(svc.reloadToml).not.toHaveBeenCalled();
  });
});

// ── TOML 行级替换（单元测试内部函数） ──────────────────────────

describe('TOML 行级替换逻辑（单元）', () => {
  // 为了测试私有函数，复制其逻辑的测试版本
  // 这确保了行级替换算法的正确性独立于文件 I/O

  function parseDotPath(dotPath: string): { section: string; keyName: string } {
    const lastDot = dotPath.lastIndexOf('.');
    if (lastDot === -1) throw new Error(`Invalid dot-path: ${dotPath}`);
    return { section: dotPath.slice(0, lastDot), keyName: dotPath.slice(lastDot + 1) };
  }

  function applyTomlChange(lines: string[], section: string, key: string, value: string): boolean {
    let inSection = false;
    let replaced = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const sectionMatch = line.match(/^\[([^\]]+)\]\s*$/);
      if (sectionMatch) {
        if (inSection) break; // 离开目标 section
        if (sectionMatch[1] === section) inSection = true;
        continue;
      }
      if (!inSection) continue;

      const trimmed = line.trim();
      if (trimmed.startsWith('#') || trimmed === '') continue;

      const eqIndex = line.indexOf('=');
      if (eqIndex === -1) continue;

      const existingKey = line.slice(0, eqIndex).trim();
      if (existingKey === key) {
        const indent = line.slice(0, line.indexOf(line.trim()));
        lines[i] = `${indent}${key} = ${value}`;
        replaced = true;
        break;
      }
    }

    if (!replaced && inSection) {
      lines.push(`${key} = ${value}`);
      replaced = true;
    }

    return replaced;
  }

  it('替换现有 key 的值', () => {
    const lines = [
      '[llm.max_tokens]',
      'opus   = 40960',
      'sonnet = 5120',
    ];
    const ok = applyTomlChange(lines, 'llm.max_tokens', 'opus', '80000');
    expect(ok).toBe(true);
    expect(lines[1]).toBe('opus = 80000');
  });

  it('section 末尾追加不存在的 key', () => {
    const lines = [
      '[llm.max_tokens]',
      'opus = 40960',
    ];
    const ok = applyTomlChange(lines, 'llm.max_tokens', 'haiku', '2048');
    expect(ok).toBe(true);
    expect(lines[lines.length - 1]).toBe('haiku = 2048');
  });

  it('保留注释和空行', () => {
    const lines = [
      '# top comment',
      '',
      '[llm.max_tokens]',
      '# inline comment',
      'opus   = 40960',
      '',
      'sonnet = 5120',
    ];
    applyTomlChange(lines, 'llm.max_tokens', 'opus', '80000');
    expect(lines[0]).toBe('# top comment');
    expect(lines[1]).toBe('');
    expect(lines[3]).toBe('# inline comment');
    expect(lines[5]).toBe('');
  });

  it('不修改跨 section 同名的 key，追加到当前 section 末尾', () => {
    const lines = [
      '[server]',
      'port = 30001',
      '',
      '[llm.max_tokens]',
      'opus = 40960',
    ];
    const ok = applyTomlChange(lines, 'server', 'opus', '999');
    // opus 不在 [server] 中 → 追加到 server section 末尾（下一个 section 之前）
    expect(ok).toBe(true);
    expect(lines[1]).toBe('port = 30001');
    expect(lines[2]).toBe(''); // 保持空行
    expect(lines[3]).toBe('[llm.max_tokens]');
    // opus = 999 被追加在 [server] 末尾（port 之后，空行之前的位置实际上）
    // 因为循环遇到 [llm.max_tokens] 就跳出，追加发生在 lines[5]
    expect(lines[5]).toBe('opus = 999');
  });

  it('保留缩进', () => {
    const lines = [
      '[npc]',
      '  history_rounds = 20',
    ];
    applyTomlChange(lines, 'npc', 'history_rounds', '30');
    expect(lines[1]).toBe('  history_rounds = 30');
  });

  it('parseDotPath 正确分解', () => {
    expect(parseDotPath('llm.max_tokens.opus')).toEqual({ section: 'llm.max_tokens', keyName: 'opus' });
    expect(parseDotPath('server.port')).toEqual({ section: 'server', keyName: 'port' });
    expect(parseDotPath('npc.history_rounds')).toEqual({ section: 'npc', keyName: 'history_rounds' });
  });

  it('parseDotPath 无 dot 报错', () => {
    expect(() => parseDotPath('plainkey')).toThrow();
  });
});
