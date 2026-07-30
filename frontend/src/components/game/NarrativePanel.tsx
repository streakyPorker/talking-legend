import { useGameStore } from '../../stores/gameStore.js';
import { NarrativeLine } from './NarrativeLine.js';
import { regionCN } from '../../utils/i18n.js';

interface NarrativePanelProps {
  isLoading: boolean;
}

export function NarrativePanel({ isLoading }: NarrativePanelProps) {
  const narrative = useGameStore((s) => s.narrative);
  const gameState = useGameStore((s) => s.gameState);

  if (!gameState) return null;

  return (
    <div className="flex-1 overflow-y-auto pr-4">
      {narrative.length === 0 && (
        <p className="text-base-content/60 italic text-base leading-relaxed">
          你伫立在{regionCN(gameState.world.currentRegion)}的边缘，{gameState.player.name}。
          古老的大地在脚下延伸，无数未讲述的故事等待着你的到来。
          你打算做什么？
        </p>
      )}
      {narrative.map((line, i) => {
        if (line.startsWith('>'))
          return <NarrativeLine key={i} type="player" text={line} />;
        return <NarrativeLine key={i} type="world" text={line} />;
      })}
      {isLoading && (
        <p className="text-base-content/60 italic animate-pulse">
          命运之轮转动中…
        </p>
      )}
    </div>
  );
}
