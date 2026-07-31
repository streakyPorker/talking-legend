import { describe, it, expect, vi } from 'vitest';
import { ConfigController } from './config.controller.js';
import { ConfigService } from './config.service.js';

// controller 是纯编排层 — 只验证转发到 service，业务逻辑由 config.service.spec 覆盖。
function createMockService(overrides: Partial<ConfigService> = {}): ConfigService {
  return {
    getConfigData: vi.fn().mockReturnValue({ sections: [] }),
    applyChanges: vi.fn().mockReturnValue({ applied: [], restartRequired: [], errors: [] }),
    resetToDefault: vi.fn().mockReturnValue({ success: true, message: 'ok' }),
    ...overrides,
  } as unknown as ConfigService;
}

describe('ConfigController — 薄壳转发', () => {
  it('getConfig 转发到 service.getConfigData', () => {
    const svc = createMockService();
    const ctrl = new ConfigController(svc);

    const res = ctrl.getConfig();

    expect(svc.getConfigData).toHaveBeenCalled();
    expect(res).toHaveProperty('sections');
  });

  it('updateConfig 转发到 service.applyChanges', () => {
    const svc = createMockService();
    const ctrl = new ConfigController(svc);

    const body = { changes: { 'server.port': 9999 } };
    ctrl.updateConfig(body);

    expect(svc.applyChanges).toHaveBeenCalledWith(body.changes);
  });

  it('updateConfig 无 changes 时透传 undefined（校验在 service）', () => {
    const svc = createMockService();
    const ctrl = new ConfigController(svc);

    ctrl.updateConfig({} as { changes: Record<string, string | number> });

    expect(svc.applyChanges).toHaveBeenCalledWith(undefined);
  });

  it('resetConfig 转发到 service.resetToDefault', () => {
    const svc = createMockService();
    const ctrl = new ConfigController(svc);

    const res = ctrl.resetConfig();

    expect(svc.resetToDefault).toHaveBeenCalled();
    expect(res.success).toBe(true);
  });
});
