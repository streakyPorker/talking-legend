import { useGameStore } from '../../stores/gameStore.js';
import { questStatusCN } from '../../utils/i18n.js';

export function QuestList() {
  const gameState = useGameStore((s) => s.gameState);
  if (!gameState) return null;

  const quests = gameState.player.quests;

  return (
    <section>
      <h2 className="text-xs text-base-content/60 uppercase tracking-wider mb-1">
        📋 任务
      </h2>
      {quests.length === 0 ? (
        <p className="text-base-content/60 text-xs italic">暂无任务</p>
      ) : (
        <ul className="list-none p-0 m-0">
          {quests.map((q) => (
            <li key={q.id} className="flex justify-between items-center py-1 text-xs">
              <span>{q.title}</span>
              <span className={`text-[0.65rem] px-1 py-0.5 rounded ${
                q.status === 'active' ? 'bg-blue-500/10 text-blue-500' :
                q.status === 'completed' ? 'bg-green-500/10 text-green-500' :
                'bg-red-500/10 text-red-500'
              }`}>
                {questStatusCN(q.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
