import { useState, useEffect } from 'react';
import type { GameState } from '@talking-legend/shared';
import { GameSetup } from './components/GameSetup.js';
import { GameScreen } from './components/GameScreen.js';
import { ConfigScreen } from './components/ConfigScreen.js';

export function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // 按 Esc 关闭配置面板
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConfig(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      {/* 全局齿轮按钮 — 始终可见 */}
      <button
        onClick={() => setShowConfig(true)}
        className="btn btn-ghost btn-circle text-2xl fixed top-3 right-3 z-50"
        aria-label="打开配置"
      >
        ⚙
      </button>

      {!gameState ? (
        <GameSetup onGameStart={setGameState} />
      ) : (
        <GameScreen gameState={gameState} onGameUpdate={setGameState} />
      )}

      {showConfig && <ConfigScreen onClose={() => setShowConfig(false)} />}
    </>
  );
}
