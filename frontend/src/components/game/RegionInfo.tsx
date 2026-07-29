import { useGameStore } from '../../stores/gameStore.js';
import { regionCN } from '../../utils/i18n.js';

export function RegionInfo() {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  const currentRegion = gameState.world.regions.find(
    (r) => r.id === gameState.world.currentRegion,
  );

  return (
    <section>
      <h2 className="text-xs text-base-content/60 uppercase tracking-wider mb-1">
        📍 当前位置
      </h2>
      <p className="text-primary font-semibold text-base my-1">
        {regionCN(gameState.world.currentRegion)}
      </p>
      <p className="text-base-content/60 text-xs leading-relaxed">
        {currentRegion?.description ?? ''}
      </p>
    </section>
  );
}
