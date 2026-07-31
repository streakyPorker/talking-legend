import { useEffect, useState, useCallback } from 'react';
import { listSaves, saveGame, loadSave, deleteSave } from '../../services/api.js';
import type { SaveMeta } from '../../services/api.js';
import { Toast, ToastContainer } from '../ui/Toast.js';
import { regionCN } from '../../utils/i18n.js';

/** SQLite datetime → 本地时间字符串 */
function formatTime(dt: string): string {
  try {
    const d = new Date(dt.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return dt;
    return d.toLocaleString('zh-CN');
  } catch { return dt; }
}

interface SaveManagerProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
}

export function SaveManager({ isOpen, onClose, gameId }: SaveManagerProps) {
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmLoad, setConfirmLoad] = useState<number | null>(null);

  const fetchSaves = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listSaves(gameId);
      setSaves(data);
    } catch {
      setToast({ message: '读取存档失败', type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    if (isOpen) {
      fetchSaves();
      setConfirmLoad(null);
    }
  }, [isOpen, fetchSaves]);

  const dismissToast = useCallback(() => setToast(null), []);

  const handleSave = async (slot: number) => {
    try {
      await saveGame(gameId, slot);
      setToast({ message: `已保存到槽位 ${slot}`, type: 'success' });
      await fetchSaves();
    } catch {
      setToast({ message: '保存失败', type: 'error' });
    }
  };

  const handleLoad = async (slot: number) => {
    try {
      await loadSave(slot);
      setToast({ message: '已读取存档，页面即将刷新', type: 'success' });
      setTimeout(() => window.location.reload(), 1500);
    } catch {
      setToast({ message: '读取存档失败', type: 'error' });
    }
  };

  const handleDelete = async (slot: number) => {
    if (!window.confirm(`确定删除槽位 ${slot} 的存档？`)) return;
    try {
      await deleteSave(slot);
      setToast({ message: `已删除槽位 ${slot} 的存档`, type: 'success' });
      await fetchSaves();
    } catch {
      setToast({ message: '删除失败', type: 'error' });
    }
  };

  const renderSlot = (slot: number) => {
    const save = saves.find((s) => s.slot === slot);
    const isAuto = slot === 0;

    if (!save) {
      return (
        <div key={slot} className="card bg-base-200 border border-base-300 p-4 flex flex-row items-center justify-between">
          <div>
            <span className="font-bold text-sm">
              {isAuto ? '⚡ 自动存档（槽位 0）' : `槽位 ${slot}`}
            </span>
            <p className="text-base-content/50 text-sm mt-1">空槽位</p>
          </div>
          {!isAuto && (
            <button
              onClick={() => handleSave(slot)}
              className="btn btn-primary btn-sm"
            >
              保存到此
            </button>
          )}
        </div>
      );
    }

    return (
      <div key={slot} className="card bg-base-200 border border-base-300 p-4">
        <div className="flex flex-row items-start justify-between">
          <div className="flex-1 min-w-0">
            <span className="font-bold text-sm">
              {isAuto ? '⚡ 自动存档（槽位 0）' : `槽位 ${slot}`}
            </span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-sm">
              <span className="text-base-content/70">玩家</span>
              <span>{save.player_name}</span>
              <span className="text-base-content/70">回合</span>
              <span>{save.turn}</span>
              <span className="text-base-content/70">区域</span>
              <span>{regionCN(save.region)}</span>
              <span className="text-base-content/70">世界</span>
              <span>{save.world}</span>
              <span className="text-base-content/70">时间</span>
              <span>{formatTime(save.saved_at)}</span>
            </div>
          </div>
          <div className="flex gap-2 ml-4 shrink-0">
            {confirmLoad === slot ? (
              <>
                <button
                  onClick={() => handleLoad(slot)}
                  className="btn btn-warning btn-xs"
                >
                  确认读取
                </button>
                <button
                  onClick={() => setConfirmLoad(null)}
                  className="btn btn-ghost btn-xs"
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmLoad(slot)}
                className="btn btn-info btn-xs"
              >
                读取
              </button>
            )}
            {!isAuto && (
              <button
                onClick={() => handleSave(slot)}
                className="btn btn-primary btn-xs"
              >
                覆盖
              </button>
            )}
            {!isAuto && (
              <button
                onClick={() => handleDelete(slot)}
                className="btn btn-error btn-xs"
              >
                删除
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="modal modal-open">
        <div className="modal-box max-w-2xl">
          {/* 标题栏 */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-lg">存档管理</h3>
            <button
              onClick={onClose}
              className="btn btn-sm btn-circle btn-ghost"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <span className="loading loading-spinner loading-md"></span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* 自动存档 */}
              <div>
                <h4 className="text-sm font-semibold text-base-content/70 mb-2">自动存档</h4>
                {renderSlot(0)}
              </div>

              {/* 手动存档 */}
              <div>
                <h4 className="text-sm font-semibold text-base-content/70 mb-2">手动存档</h4>
                <div className="flex flex-col gap-2">
                  {[1, 2, 3, 4, 5].map(renderSlot)}
                </div>
              </div>
            </div>
          )}
        </div>
        {/* 点击遮罩关闭 */}
        <div className="modal-backdrop" onClick={onClose}></div>
      </div>

      {toast && (
        <ToastContainer>
          <Toast message={toast.message} type={toast.type} onDismiss={dismissToast} />
        </ToastContainer>
      )}
    </>
  );
}
