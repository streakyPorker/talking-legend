import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { GameState } from '@talking-legend/shared';
import { useGameStore } from '../../stores/gameStore.js';
import { useGameAction } from '../../hooks/useGameAction.js';
import { GameHeader } from './GameHeader.js';
import { NarrativePanel } from './NarrativePanel.js';
import { RegionSidebar } from './RegionSidebar.js';
import { ActionBar } from './ActionBar.js';

interface GameScreenProps {
  onOpenConfig: () => void;
}

export function GameScreen({ onOpenConfig }: GameScreenProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const gameState = useGameStore((s) => s.gameState);
  const setGameState = useGameStore((s) => s.setGameState);

  // 从 location.state 恢复游戏状态（兼容旧导航方式）
  const initialGameState = (location.state as { gameState?: unknown } | null)?.gameState;
  if (initialGameState && !gameState) {
    setGameState(initialGameState as GameState);
  }

  // 无游戏状态则重定向回首页
  useEffect(() => {
    if (!gameState) {
      navigate('/', { replace: true });
    }
  }, [gameState, navigate]);

  const { execute, isLoading, error, toolToast } = useGameAction();

  if (!gameState) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <GameHeader onOpenConfig={onOpenConfig} />
      {toolToast && (
        <div className="alert alert-info rounded-none border-0 text-sm py-2">
          <span className="loading loading-spinner loading-xs"></span>
          {toolToast.message}
        </div>
      )}
      <main className="flex-1 flex gap-4 p-6 overflow-hidden">
        <NarrativePanel isLoading={isLoading} error={error} />
        <RegionSidebar />
      </main>
      <ActionBar onSubmit={execute} isLoading={isLoading} />
    </div>
  );
}
