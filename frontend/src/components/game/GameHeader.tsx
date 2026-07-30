import { useGameStore } from '../../stores/gameStore.js';
import { GameStatusBar } from './GameStatusBar.js';

interface GameHeaderProps {
  onOpenConfig: () => void;
  onOpenSaves?: () => void;
}

export function GameHeader({ onOpenConfig, onOpenSaves }: GameHeaderProps) {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  return (
    <header className="flex justify-between items-center px-6 py-3 bg-base-200 border-b border-base-300">
      <h1 className="font-title text-primary text-xl">{gameState.world.name}</h1>
      <div className="flex items-center gap-2">
        <GameStatusBar />
        <button
          onClick={onOpenSaves}
          className="btn btn-ghost btn-circle text-2xl"
          aria-label="打开存档"
        >
          💾
        </button>
        <button
          onClick={onOpenConfig}
          className="btn btn-ghost btn-circle text-2xl"
          aria-label="打开配置"
        >
          ⚙
        </button>
      </div>
    </header>
  );
}
