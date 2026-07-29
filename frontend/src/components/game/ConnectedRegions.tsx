import { useState } from 'react';
import { useGameStore } from '../../stores/gameStore.js';
import { regionCN } from '../../utils/i18n.js';
import { moveToRegion } from '../../services/api.js';

export function ConnectedRegions() {
  const gameState = useGameStore((s) => s.gameState);
  const setGameState = useGameStore((s) => s.setGameState);
  const [isMoving, setIsMoving] = useState(false);

  if (!gameState) return null;

  const connected = gameState.world.regions.filter(
    (r) => gameState.world.regions
      .find((x) => x.id === gameState.world.currentRegion)
      ?.connectedRegions?.includes(r.id),
  );

  if (connected.length === 0) return null;

  const handleMove = async (regionId: string) => {
    if (isMoving) return;
    setIsMoving(true);
    try {
      const result = await moveToRegion(gameState.id, regionId);
      setGameState(result.data.gameState);
    } catch {
      // ignore — button re-enabled automatically
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <section>
      <h2 className="text-xs text-base-content/60 uppercase tracking-wider mb-1">🌍 可前往</h2>
      <ul className="list-none p-0 m-0 text-sm">
        {connected.map((r) => (
          <li key={r.id} className="py-0.5">
            <button
              onClick={() => handleMove(r.id)}
              className="btn btn-ghost btn-xs"
              disabled={isMoving}
              aria-label={`移动到${regionCN(r.id)}`}
            >
              {regionCN(r.id)}
            </button>
            <span className="text-base-content/60 text-xs ml-1">{r.description.slice(0, 20)}…</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
