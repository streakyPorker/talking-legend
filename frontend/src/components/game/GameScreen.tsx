import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { GameState, NPCState } from '@talking-legend/shared';
import { useGameStore } from '../../stores/gameStore.js';
import { useGameAction } from '../../hooks/useGameAction.js';
import { GameHeader } from './GameHeader.js';
import { NarrativePanel } from './NarrativePanel.js';
import { RegionSidebar } from './RegionSidebar.js';
import { ActionBar } from './ActionBar.js';
import { NpcDialogueDrawer } from './NpcDialogueDrawer.js';
import { SaveManager } from './SaveManager.js';
import { Toast, ToastContainer } from '../ui/Toast.js';
import { saveGame, getGameState } from '../../services/api.js';

interface GameScreenProps {
  onOpenConfig: () => void;
}

export function GameScreen({ onOpenConfig }: GameScreenProps) {
  const { gameId: routeGameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const gameState = useGameStore((s) => s.gameState);
  const setGameState = useGameStore((s) => s.setGameState);
  const restoreGame = useGameStore((s) => s.restoreGame);

  // 刷新/读档恢复: 从后端加载完整状态（含叙事）
  useEffect(() => {
    if (!gameState && routeGameId) {
      getGameState(routeGameId)
        .then((full) => restoreGame(full, full.narrative))
        .catch(() => navigate('/', { replace: true }));
    }
  }, [gameState, routeGameId, restoreGame, navigate]);

  // 无游戏状态且无 routeGameId → 重定向
  useEffect(() => {
    if (!gameState && !routeGameId) {
      navigate('/', { replace: true });
    }
  }, [gameState, routeGameId, navigate]);

  const { execute, isLoading, error, toolToast } = useGameAction();
  const [selectedNpc, setSelectedNpc] = useState<NPCState | null>(null);

  const handleNpcClick = useCallback(
    (npc: { id: string; name: string; role: string; personality: string; currentMood: string }) => {
      if (!gameState) return;
      const fullNpc = gameState.npcs.find((n) => n.id === npc.id) ?? null;
      setSelectedNpc(fullNpc);
    },
    [gameState],
  );

  // API error → toast (auto-dismiss + persist across multiple errors)
  const [errorKey, setErrorKey] = useState(0);
  const dismissError = useCallback(() => setErrorKey((k) => k + 1), []);
  const [showSaves, setShowSaves] = useState(false);

  // Auto-save: every 5 turns
  const [saveToast, setSaveToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const dismissSaveToast = useCallback(() => setSaveToast(null), []);
  const prevTurnRef = useRef(gameState?.turn ?? 0);
  useEffect(() => {
    const currentTurn = gameState?.turn ?? 0;
    if (currentTurn > 0 && currentTurn !== prevTurnRef.current && currentTurn % 5 === 0) {
      prevTurnRef.current = currentTurn;
      saveGame(gameState?.id ?? '', 0)
        .then(() => setSaveToast({ message: '自动存档成功', type: 'success' }))
        .catch(() => setSaveToast({ message: '自动存档失败', type: 'error' }));
    } else {
      prevTurnRef.current = currentTurn;
    }
  }, [gameState?.turn, gameState?.id]);

  if (!gameState) {
    return null;
  }

  return (
    <div className="h-screen flex flex-col">
      <GameHeader onOpenConfig={onOpenConfig} onOpenSaves={() => setShowSaves(true)} />
      {toolToast && (
        <div className="alert alert-info rounded-none border-0 text-sm py-2">
          <span className="loading loading-spinner loading-xs"></span>
          {toolToast.message}
        </div>
      )}
      <main className="flex-1 flex gap-4 p-6 overflow-hidden">
        <NarrativePanel isLoading={isLoading} />
        <RegionSidebar onNpcClick={handleNpcClick} />
      </main>
      <ActionBar onSubmit={execute} isLoading={isLoading} />

      {/* 错误通知 — 右上角弹窗 */}
      <ToastContainer>
        {error && (
          <Toast
            key={errorKey}
            message={error}
            type="error"
            onDismiss={dismissError}
          />
        )}
        {saveToast && (
          <Toast
            message={saveToast.message}
            type={saveToast.type}
            onDismiss={dismissSaveToast}
          />
        )}
      </ToastContainer>

      <SaveManager isOpen={showSaves} onClose={() => setShowSaves(false)} gameId={gameState.id} />

      <NpcDialogueDrawer
        npc={selectedNpc}
        gameId={gameState.id}
        isOpen={!!selectedNpc}
        onClose={() => setSelectedNpc(null)}
        playerName={gameState.player.name}
      />
    </div>
  );
}
