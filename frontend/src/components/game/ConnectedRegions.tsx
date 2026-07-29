import { useGameStore } from '../../stores/gameStore.js';
import { regionCN } from '../../utils/i18n.js';

export function ConnectedRegions() {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  const connected = gameState.world.regions.filter(
    (r) => gameState.world.regions
      .find((x) => x.id === gameState.world.currentRegion)
      ?.connectedRegions?.includes(r.id),
  );

  if (connected.length === 0) return null;

  return (
    <section>
      <h2 className="text-xs text-base-content/60 uppercase tracking-wider mb-1">
        🌍 可前往
      </h2>
      <ul className="list-none p-0 m-0 text-sm">
        {connected.map((r) => (
          <li key={r.id} className="py-0.5">
            {regionCN(r.id)}{' '}
            <span className="text-base-content/60 text-xs">{r.description.slice(0, 20)}…</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
