import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService, parseDotPath, applyTomlChange } from './config.service.js';

// PUT 测试需要模拟文件 I/O。vi.hoisted 让工厂能引用 spy。
const { writeSpy } = vi.hoisted(() => ({ writeSpy: vi.fn() }));

vi.mock('fs', () => ({
  readFileSync: () =>
    '[llm.max_tokens]\nopus = 40960\nsonnet = 5120\n' +
    '[npc]\nhistory_rounds = 20\n' +
    '[server]\nport = 31943\n' +
    '[model_tiers]\nopus = ["claude-opus-4"]\n',
  writeFileSync: writeSpy,
  existsSync: () => true,
  copyFileSync: () => {},
  mkdirSync: () => {},
  readdirSync: () => [],
  statSync: () => ({ isDirectory: () => true }),
  constants: {},
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
}));

function createService(): ConfigService {
  return new ConfigService();
}

describe('ConfigService — GET 结构 (getConfigData)', () => {
  it('返回 8 个 section 共 17 个配置项', () => {
    const svc = createService();
    const res = svc.getConfigData();

    expect(res).toHaveProperty('sections');
    expect(res.sections).toHaveLength(8);

    const totalItems = res.sections.reduce((s, sec) => s + sec.items.length, 0);
    expect(totalItems).toBe(17);
  });

  it('anthropic section restartRequired=true, items hotReload=false', () => {
    const res = createService().getConfigData();
    const sec = res.sections.find((s) => s.key === 'anthropic')!;
    expect(sec.restartRequired).toBe(true);
    sec.items.forEach((item) => {
      expect(item.hotReload).toBe(false);
    });
  });

  it('llm.max_tokens section restartRequired=false, items hotReload=true', () => {
    const res = createService().getConfigData();
    const sec = res.sections.find((s) => s.key === 'llm.max_tokens')!;
    expect(sec.restartRequired).toBe(false);
    sec.items.forEach((item) => {
      expect(item.hotReload).toBe(true);
    });
  });

  it('每个配置项的 value 类型正确', () => {
    const res = createService().getConfigData();
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

  it('model_tiers 不再是 readonly（允许编辑）', () => {
    const res = createService().getConfigData();
    const sec = res.sections.find((s) => s.key === 'model_tiers')!;
    for (const item of sec.items) {
      expect(item.readonly).toBe(false);
    }
  });

  it('password 类型返回 ****（守卫仍在）', () => {
    const svc = createService();
    const passwordItem = {
      key: 'api_key',
      tomlPath: 'anthropic.api_key',
      label: 'API Key',
      type: 'password' as const,
      hotReload: false,
      readonly: false,
    };
    type Svc = { resolveValue(item: typeof passwordItem): string | number };
    const value = (svc as unknown as Svc).resolveValue(passwordItem);
    expect(value).toBe('****');
  });
});

describe('ConfigService — PUT (applyChanges)', () => {
  beforeEach(() => {
    writeSpy.mockClear();
  });

  it('空 changes 返回空 applied/errors', () => {
    const svc = createService();
    const res = svc.applyChanges({});
    expect(res.applied).toEqual([]);
    expect(res.errors).toEqual([]);
  });

  it('无效 body 返回错误', () => {
    const svc = createService();
    const res = svc.applyChanges(null as unknown as Record<string, string | number>);
    expect(res.errors).toContain('Invalid body: changes must be an object');
  });

  it('有效修改写入文件并热加载', () => {
    const svc = createService();
    const reloadSpy = vi.spyOn(svc, 'reloadToml');
    const res = svc.applyChanges({ 'llm.max_tokens.opus': 80000 });

    expect(res.applied).toContain('llm.max_tokens.opus');
    expect(res.errors).toEqual([]);
    expect(writeSpy).toHaveBeenCalled();
    // writeFileSync(path, content, encoding) — content 是第 2 个参数
    const written = writeSpy.mock.calls[0]?.[1] as string;
    expect(written).toContain('opus = 80000');
    expect(reloadSpy).toHaveBeenCalled();
  });

  it('model_tiers 允许写入（不再只读）', () => {
    const svc = createService();
    const res = svc.applyChanges({ 'model_tiers.opus': 'claude-opus-4, test-model' });

    expect(res.errors).toEqual([]);
    expect(res.applied).toContain('model_tiers.opus');
    expect(res.restartRequired).toContain('model_tiers.opus');
  });

  it('浮点数写入整数字段返回错误', () => {
    const svc = createService();
    const res = svc.applyChanges({ 'server.port': 1234.5 });

    expect(res.errors).toContain('server.port: must be an integer');
    expect(res.applied).toEqual([]);
  });

  it('无效类型（boolean）写入返回错误', () => {
    const svc = createService();
    const res = svc.applyChanges({ 'llm.max_tokens.opus': true as unknown as number });

    expect(res.errors).toContain('llm.max_tokens.opus: value must be a string or number');
    expect(res.applied).toEqual([]);
  });

  it('errors 非空且 applied 为空时不触发写入/热加载', () => {
    const svc = createService();
    const reloadSpy = vi.spyOn(svc, 'reloadToml');
    const res = svc.applyChanges({ 'unknown.path': 'val' });

    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.applied).toEqual([]);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

describe('TOML 行级替换（导出纯函数）', () => {
  it('替换现有 key 的值', () => {
    const lines = ['[llm.max_tokens]', 'opus   = 40960', 'sonnet = 5120'];
    const ok = applyTomlChange(lines, 'llm.max_tokens', 'opus', '80000');
    expect(ok).toBe(true);
    expect(lines[1]).toBe('opus = 80000');
  });

  it('section 末尾追加不存在的 key', () => {
    const lines = ['[llm.max_tokens]', 'opus = 40960'];
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
    const lines = ['[server]', 'port = 31943', '', '[llm.max_tokens]', 'opus = 40960'];
    const ok = applyTomlChange(lines, 'server', 'opus', '999');
    expect(ok).toBe(true);
    expect(lines[1]).toBe('port = 31943');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('[llm.max_tokens]');
    expect(lines[5]).toBe('opus = 999');
  });

  it('保留缩进', () => {
    const lines = ['[npc]', '  history_rounds = 20'];
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
