import { useState, useEffect } from 'react';
import type { ConfigSection, ConfigItem } from '../../services/api.js';
import { useConfig } from '../../hooks/useConfig.js';
import { Button } from '../ui/Button.js';
import { Spinner } from '../ui/Spinner.js';
import { Toast, ToastContainer } from '../ui/Toast.js';

interface ConfigScreenProps {
  onClose: () => void;
}

export function ConfigScreen({ onClose }: ConfigScreenProps) {
  const { sections, isLoading, toasts, dismissToast, fetchConfig, saveConfig, resetToDefault } = useConfig();
  const [dirty, setDirty] = useState<Record<string, unknown>>({});
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const dotKey = (section: ConfigSection, item: ConfigItem): string =>
    `${section.key}.${item.key}`;

  const markDirty = (path: string, value: unknown) => {
    setDirty((prev) => {
      const next = { ...prev };
      if (value === '' || value === undefined) {
        delete next[path];
      } else {
        next[path] = value;
      }
      return next;
    });
  };

  const handleSave = async () => {
    await saveConfig(dirty as Record<string, string | number>);
    setDirty({});
    await fetchConfig();
  };

  const handleReset = async () => {
    const ok = await resetToDefault();
    if (ok) {
      setDirty({});
      await fetchConfig();
    }
    setShowResetConfirm(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
      <ToastContainer>
        {toasts.map((t) => (
          <Toast key={t.id} message={t.message} type={t.type} onDismiss={() => dismissToast(t.id)} />
        ))}
      </ToastContainer>

      <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="配置中心" onClick={handleBackdropClick}>
        <div className="modal-box max-w-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">{'⚙'} 配置中心</h2>
            <Button variant="circle" onClick={onClose} ariaLabel="关闭">{'✕'}</Button>
          </div>

          {isLoading ? (
            <Spinner />
          ) : (
            <>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {sections.map((section) => {
                  const sectionDirtyCount = section.items.filter((item) => dotKey(section, item) in dirty).length;

                  return (
                    <details key={section.key} className="collapse collapse-arrow bg-base-200" open>
                      <summary className="collapse-title text-sm font-medium flex items-center gap-2">
                        <span>{section.label}</span>
                        {sectionDirtyCount > 0 && (
                          <span className="badge badge-info badge-sm">{sectionDirtyCount}</span>
                        )}
                        {section.restartRequired && (
                          <span className="badge badge-warning badge-xs">需重启</span>
                        )}
                      </summary>
                      <div className="collapse-content">
                        <div className="space-y-3">
                          {section.items.map((item) => {
                            const path = dotKey(section, item);
                            const isDirty = path in dirty;

                            return (
                              <div key={path} className="form-control w-full">
                                <label className="label" htmlFor={path}>
                                  <span className="label-text flex items-center gap-1">
                                    {item.label}
                                    {item.hotReload ? (
                                      <span className="text-xs">{'\u{1F525}'}</span>
                                    ) : (
                                      <span className="text-xs text-warning">{'⚠'}需重启</span>
                                    )}
                                  </span>
                                </label>
                                {item.type === 'number' ? (
                                  <input
                                    id={path}
                                    type="number"
                                    className={`input input-bordered input-sm w-full ${isDirty ? 'input-warning' : ''}`}
                                    defaultValue={String(item.value)}
                                    disabled={item.readonly}
                                    min={item.min}
                                    max={item.max}
                                    onChange={(e) => {
                                      const val = e.target.value === '' ? '' : Number(e.target.value);
                                      markDirty(path, val === '' ? undefined : val);
                                    }}
                                  />
                                ) : (
                                  <input
                                    id={path}
                                    type="text"
                                    className={`input input-bordered input-sm w-full ${isDirty ? 'input-warning' : ''}`}
                                    defaultValue={String(item.value)}
                                    disabled={item.readonly}
                                    onChange={(e) => markDirty(path, e.target.value)}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>

              <div className="flex gap-2 justify-end mt-4">
                {showResetConfirm ? (
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-warning">确认恢复默认？</span>
                    <Button variant="ghost" onClick={handleReset}>确认</Button>
                    <Button variant="ghost" onClick={() => setShowResetConfirm(false)}>取消</Button>
                  </div>
                ) : (
                  <Button variant="ghost" onClick={() => setShowResetConfirm(true)}>恢复默认</Button>
                )}
                <Button variant="ghost" onClick={onClose}>取消</Button>
                <Button variant="primary" disabled={Object.keys(dirty).length === 0} onClick={handleSave}>保存配置</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
