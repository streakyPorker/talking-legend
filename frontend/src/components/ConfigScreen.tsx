import { useState, useEffect, useCallback } from 'react';
import { getConfig, updateConfig, resetConfig } from '../services/api.js';
import type { ConfigSection, ConfigItem } from '../services/api.js';

interface Props {
  onClose: () => void;
}

type DirtyMap = Record<string, string | number>;

/**
 * 配置中心 Modal 面板
 *
 * 组件挂载时调 GET /api/config 获取全部配置项，
 * 用户编辑后记录变更（只发与原始值不同的项），
 * 保存后根据 restartRequired 数组提示是否需要重启。
 */
export function ConfigScreen({ onClose }: Props) {
  const [sections, setSections] = useState<ConfigSection[]>([]);
  const [dirty, setDirty] = useState<DirtyMap>({});
  const [initialValues, setInitialValues] = useState<Record<string, string | number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; type: 'success' | 'error'; message: string }[]>([]);

  // 添加 toast 通知，3 秒后自动消失
  const addToast = useCallback((type: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  // 构建 dot-path
  const dotKey = useCallback((section: ConfigSection, item: ConfigItem): string => {
    return `${section.key}.${item.key}`;
  }, []);

  // 加载配置
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);

    getConfig()
      .then((data) => {
        if (cancelled) return;
        setSections(data.sections);
        // 记录初始值
        const init: Record<string, string | number> = {};
        for (const section of data.sections) {
          for (const item of section.items) {
            init[dotKey(section, item)] = item.value;
          }
        }
        setInitialValues(init);
        setDirty({});
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : '加载配置失败';
        setLoadError(msg);
        addToast('error', msg);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // 获取当前显示值（优先显示 dirty 中的编辑值）
  const displayValue = useCallback(
    (section: ConfigSection, item: ConfigItem): string | number => {
      const key = dotKey(section, item);
      return key in dirty ? dirty[key] : item.value;
    },
    [dirty, dotKey],
  );

  // 编辑变更
  const handleChange = useCallback(
    (section: ConfigSection, item: ConfigItem, newValue: string) => {
      const key = dotKey(section, item);
      let parsedValue: string | number = newValue;
      if (item.type === 'number') {
        // 允许空字符串（用户清空输入框），保存时再校验
        if (newValue === '') {
          parsedValue = '';
        } else {
          const n = Number(newValue);
          if (isNaN(n)) return;
          parsedValue = n;
        }
      }
      const initial = initialValues[key];

      setDirty((prev) => {
        const next = { ...prev };
        if (parsedValue === initial) {
          delete next[key];
        } else {
          next[key] = parsedValue;
        }
        return next;
      });
    },
    [initialValues, dotKey],
  );

  // 保存
  const handleSave = async () => {
    if (Object.keys(dirty).length === 0) {
      addToast('success', '没有需要保存的变更');
      return;
    }

    setIsSaving(true);

    try {
      const result = await updateConfig(dirty);

      if (result.errors.length > 0) {
        addToast('error', `保存部分失败：${result.errors.join('；')}`);
        return;
      }

      // 更新成功，重新拉取配置刷新 sections 中的值
      setDirty({});
      try {
        const data = await getConfig();
        setSections(data.sections);
        const init: Record<string, string | number> = {};
        for (const s of data.sections) for (const i of s.items) init[dotKey(s, i)] = i.value;
        setInitialValues(init);
      } catch { /* sections 刷新失败不影响已保存的结果 */ }

      // 提示信息
      const hotCount = result.applied.length - result.restartRequired.length;
      const restartItemCount = result.restartRequired.length;
      const parts: string[] = [];
      if (hotCount > 0) parts.push(`${hotCount} 项已热生效`);
      if (restartItemCount > 0) parts.push(`${restartItemCount} 项需重启后端`);
      addToast('success', parts.join(' · '));
    } catch (err: unknown) {
      addToast('error', err instanceof Error ? err.message : '保存配置失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 计算变更摘要
  const dirtyKeys = Object.keys(dirty);
  const hotReloadCount = dirtyKeys.reduce((acc, key) => {
    for (const section of sections) {
      for (const item of section.items) {
        if (dotKey(section, item) === key) {
          return acc + (item.hotReload ? 1 : 0);
        }
      }
    }
    return acc;
  }, 0);
  const restartCount = dirtyKeys.length - hotReloadCount;

  // 阻止 Modal 内点击传播到背景
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
      {/* Toast 通知容器 — 右上角固定 */}
      {toasts.length > 0 && (
        <div className="toast toast-top toast-end z-[100]">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`alert ${t.type === 'success' ? 'alert-success' : 'alert-error'}`}
            >
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}

      <div
        className="modal modal-open"
        role="dialog"
        aria-modal="true"
        aria-label="配置中心"
        onClick={handleBackdropClick}
      >
        <div className="modal-box max-w-2xl">
          {/* 标题栏 */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">{'⚙'} 配置中心</h2>
            <button
              className="btn btn-ghost btn-sm btn-square"
              onClick={onClose}
              aria-label="关闭"
            >
              {'✕'}
            </button>
          </div>

          {/* 加载中 */}
          {isLoading && (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-lg" />
            </div>
          )}

          {/* 加载错误 — 改用 toast 显示 */}

          {/* 配置项 */}
          {!isLoading && !loadError && (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {sections.map((section) => {
                const sectionDirtyCount = section.items.filter((item) => {
                  const key = dotKey(section, item);
                  return key in dirty;
                }).length;

                return (
                  <details
                    key={section.key}
                    className="collapse collapse-arrow bg-base-200"
                    open
                  >
                    <summary className="collapse-title text-lg font-medium">
                      <span>{section.label}</span>
                      {sectionDirtyCount > 0 && (
                        <span className="badge badge-info badge-sm ml-2">
                          {sectionDirtyCount}
                        </span>
                      )}
                      {section.restartRequired && (
                        <span className="badge badge-warning badge-sm ml-2">
                          需重启
                        </span>
                      )}
                    </summary>
                    <div className="collapse-content">
                      <div className="space-y-3">
                        {section.items.map((item) => {
                          const key = dotKey(section, item);
                          const currentValue = displayValue(section, item);
                          const isDirty = key in dirty;

                          return (
                            <div key={key} className="form-control w-full">
                              <label className="label" htmlFor={key}>
                                <span className="label-text flex items-center gap-1">
                                  {item.label}
                                  {item.hotReload && (
                                    <span className="badge badge-success badge-xs text-[10px]">
                                      {'\u{1F525}'}
                                    </span>
                                  )}
                                  {!item.hotReload && (
                                    <span className="badge badge-warning badge-xs text-[10px]">
                                      {'⚠'}需重启
                                    </span>
                                  )}
                                </span>
                              </label>
                              <input
                                id={key}
                                type={item.type === 'number' ? 'number' : 'text'}
                                className={`input input-bordered w-full ${isDirty ? 'input-warning' : ''} ${item.readonly ? 'input-disabled' : ''}`}
                                value={currentValue}
                                onChange={(e) => handleChange(section, item, e.target.value)}
                                disabled={item.readonly}
                                min={item.min}
                                max={item.max}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}

          {/* 保存结果提示 — 改用 toast 显示 */}

          {/* 底部操作栏 */}
          <div className="modal-action flex-col items-stretch gap-2">
            {/* 变更摘要 */}
            {dirtyKeys.length > 0 && (
              <p className="text-sm text-base-content/70 text-center">
                {dirtyKeys.length} 项变更 {'·'} {hotReloadCount} 项热生效
                {restartCount > 0 && ` · ${restartCount} 项需重启后端`}
              </p>
            )}

            <div className="flex gap-2 justify-end">
              <button
                className="btn btn-ghost btn-warning"
                onClick={async () => {
                  if (!confirm('确定恢复所有配置项为默认值？此操作不可撤销。')) return;
                  try {
                    const r = await resetConfig();
                    addToast(r.success ? 'success' : 'error', r.message);
                    if (r.success) {
                      setDirty({});
                      const data = await getConfig();
                      const init: Record<string, string | number> = {};
                      for (const s of data.sections) for (const i of s.items) init[dotKey(s, i)] = i.value;
                      setInitialValues(init);
                      setSections(data.sections);
                    }
                  } catch (err: unknown) {
                    addToast('error', err instanceof Error ? err.message : '恢复失败');
                  }
                }}
                disabled={isSaving}
              >
                恢复默认
              </button>
              <button className="btn btn-ghost" onClick={onClose} disabled={isSaving}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={isSaving || dirtyKeys.length === 0}
              >
                {isSaving && <span className="loading loading-spinner" />}
                保存配置
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
