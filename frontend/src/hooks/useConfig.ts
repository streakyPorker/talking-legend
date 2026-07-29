import { useState, useRef, useCallback } from 'react';
import type { ConfigSection } from '../services/api.js';
import { getConfig, updateConfig, resetConfig } from '../services/api.js';
import type { ToastType } from '../components/ui/Toast.js';

interface ConfigToast {
  id: number;
  message: string;
  type: ToastType;
}

export function useConfig() {
  const [sections, setSections] = useState<ConfigSection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toasts, setToasts] = useState<ConfigToast[]>([]);
  const toastIdRef = useRef(0);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getConfig();
      setSections(data.sections);
    } catch {
      addToast('加载配置失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  const saveConfig = useCallback(
    async (changes: Record<string, string | number>) => {
      try {
        const result = await updateConfig(changes);
        const applied = result.applied.length;
        const needRestart = result.restartRequired.length;
        if (applied > 0) {
          addToast(
            needRestart > 0
              ? `${applied} 项已保存（${needRestart} 项需重启生效）`
              : `${applied} 项已热加载生效`,
            'success',
          );
        }
        if (result.errors.length > 0) {
          result.errors.forEach((e) => addToast(e, 'error'));
        }
        return result;
      } catch {
        addToast('保存失败', 'error');
        return null;
      }
    },
    [addToast],
  );

  const resetToDefault = useCallback(async () => {
    try {
      await resetConfig();
      addToast('已恢复默认配置', 'success');
      return true;
    } catch {
      addToast('恢复默认失败', 'error');
      return false;
    }
  }, [addToast]);

  return {
    sections,
    isLoading,
    toasts,
    dismissToast,
    fetchConfig,
    saveConfig,
    resetToDefault,
  };
}
