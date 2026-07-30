import { useGameStore } from '../../stores/gameStore.js';

interface NearbyNpcsProps {
  onNpcClick?: (npc: { id: string; name: string; role: string; personality: string; currentMood: string }) => void;
}

export function NearbyNpcs({ onNpcClick }: NearbyNpcsProps) {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  const nearby = gameState.npcs.filter(
    (npc) => npc.location === gameState.world.currentRegion,
  );

  return (
    <section>
      <h2 className="text-xs text-base-content/60 uppercase tracking-wider mb-1">
        👥 附近人物
      </h2>
      {nearby.map((npc) => (
        <div
          key={npc.id}
          className={`flex flex-col p-2 mb-1 bg-base-200 rounded-md border border-base-300 ${
            onNpcClick ? 'cursor-pointer hover:bg-base-100' : ''
          }`}
          onClick={() => onNpcClick?.(npc)}
          title={onNpcClick ? '点击对话' : undefined}
        >
          <strong className="text-primary text-sm">{npc.name}</strong>
          <span className="text-base-content/60 text-xs">{npc.role}</span>
          <span className="text-sm mt-0.5">{npc.currentMood}</span>
        </div>
      ))}
    </section>
  );
}
