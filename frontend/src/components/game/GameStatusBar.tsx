import { useGameStore } from '../../stores/gameStore.js';
import { regionCN, timeCN, weatherCN } from '../../utils/i18n.js';

export function GameStatusBar() {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  return (
    <div className="flex gap-6 text-base-content/60 text-sm">
      <span>{regionCN(gameState.world.currentRegion)} · 第 {gameState.turn} 回合</span>
      <span>{timeCN(gameState.world.timeOfDay)} · {weatherCN(gameState.world.weather)}</span>
    </div>
  );
}
