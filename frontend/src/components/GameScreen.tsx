import { useState, type FormEvent } from 'react';
import type { GameState, Region } from '@talking-legend/shared';
import { performActionStream } from '../services/api.js';

/** 区域名中文映射 */
const REGION_CN: Record<string, string> = {
  village: '石辉村',
  forest: '低语森林',
  lake: '镜湖',
  mountains: '龙脊峰',
};
function cn(id: string): string { return REGION_CN[id] ?? id; }

/** 天气中文 */
const WEATHER_CN: Record<string, string> = {
  clear: '晴朗', cloudy: '多云', rain: '雨', storm: '暴风雨',
  fog: '雾', snow: '雪',
};
function weatherCN(w: string): string { return WEATHER_CN[w] ?? w; }

/** 时间中文 */
const TIME_CN: Record<string, string> = {
  morning: '清晨', afternoon: '午后', evening: '黄昏', night: '深夜',
};
function timeCN(t: string): string { return TIME_CN[t] ?? t; }

/** 简易 markdown 渲染 */
function renderMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    return part;
  });
}

interface GameScreenProps {
  gameState: GameState;
  onGameUpdate: (state: GameState) => void;
}

export function GameScreen({ gameState, onGameUpdate }: GameScreenProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [narrative, setNarrative] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 可到达区域
  const connected = gameState.world.regions.filter(
    (r) => gameState.world.regions
      .find((x) => x.id === gameState.world.currentRegion)
      ?.connectedRegions?.includes(r.id),
  );

  const handleAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const actionText = input.trim();
    setInput('');
    setIsLoading(true);
    setError(null);

    const playerLine = `> ${actionText}`;
    setNarrative((prev) => [...prev, playerLine]);

    try {
      const reader = await performActionStream(gameState.id, actionText);
      let currentChunk = '';
      setNarrative((prev) => [...prev, '']);

      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === 'chunk') {
            currentChunk += data.content;
            setNarrative((prev) => { const c = [...prev]; c[c.length - 1] = currentChunk; return c; });
          } else if (data.type === 'done') {
            onGameUpdate({ ...gameState, turn: data.turn });
            fetch('/api/playtest/record', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ worldId: 'aethelgard', playerName: gameState.player.name, action: actionText, narrative: currentChunk, turn: data.turn, tokenEstimate: data.tokenEstimate }),
            }).catch(() => {});
          } else if (data.type === 'error') {
            setError(data.message);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '行动失败');
    } finally {
      setIsLoading(false);
    }
  };

  const currentRegion = gameState.world.regions.find((r) => r.id === gameState.world.currentRegion);

  return (
    <div className="game-screen">
      <header className="game-header">
        <h1 className="game-world-name">{gameState.world.name}</h1>
        <div className="game-info">
          <span>{cn(gameState.world.currentRegion)} · 第 {gameState.turn} 回合</span>
          <span>{timeCN(gameState.world.timeOfDay)} · {weatherCN(gameState.world.weather)}</span>
        </div>
      </header>

      <main className="game-main">
        <div className="narrative-panel">
          {narrative.length === 0 && (
            <p className="intro-text">
              你伫立在{cn(gameState.world.currentRegion)}的边缘，{gameState.player.name}。
              古老的大地在脚下延伸，无数未讲述的故事等待着你的到来。
              你打算做什么？
            </p>
          )}
          {narrative.map((line, i) => {
            if (line.startsWith('>')) return <p key={i} className="player-action">{line}</p>;
            const paras = line.split('\n\n');
            return (
              <div key={i} className="world-narrative">
                {paras.map((p, j) => <p key={j}>{renderMarkdown(p)}</p>)}
              </div>
            );
          })}
          {isLoading && <p className="thinking-indicator">命运之轮转动中…</p>}
          {error && <p className="action-error">{error}</p>}
        </div>

        {/* 右侧信息面板 */}
        <aside className="info-sidebar">
          {/* 当前位置 */}
          <section className="info-section">
            <h2>📍 当前位置</h2>
            <p className="region-name">{cn(gameState.world.currentRegion)}</p>
            <p className="region-desc">{currentRegion?.description ?? ''}</p>
          </section>

          {/* 可前往区域 */}
          {connected.length > 0 && (
            <section className="info-section">
              <h2>🌍 可前往</h2>
              <ul className="region-list">
                {connected.map((r) => (
                  <li key={r.id}>{cn(r.id)} <span className="region-desc-sm">{r.description.slice(0, 20)}…</span></li>
                ))}
              </ul>
            </section>
          )}

          {/* 任务 */}
          <section className="info-section">
            <h2>📋 任务</h2>
            {gameState.player.quests.length === 0 ? (
              <p className="muted-text">暂无任务</p>
            ) : (
              <ul className="quest-list">
                {gameState.player.quests.map((q) => (
                  <li key={q.id} className={`quest-item quest-${q.status}`}>
                    <span className="quest-title">{q.title}</span>
                    <span className="quest-status">{q.status === 'active' ? '进行中' : q.status === 'completed' ? '已完成' : '失败'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 附近人物 */}
          <section className="info-section">
            <h2>👥 附近人物</h2>
            {gameState.npcs
              .filter((npc) => npc.location === gameState.world.currentRegion)
              .map((npc) => (
                <div key={npc.id} className="npc-card">
                  <strong>{npc.name}</strong>
                  <span className="npc-role">{npc.role}</span>
                  <span className="npc-mood">{npc.currentMood}</span>
                </div>
              ))}
          </section>
        </aside>
      </main>

      <footer className="game-footer">
        <form onSubmit={handleAction} className="action-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="你想做什么？"
            className="action-input"
            disabled={isLoading}
            autoFocus
          />
          <button type="submit" className="action-button" disabled={isLoading || !input.trim()}>
            行动
          </button>
        </form>
      </footer>

      <style>{`
        .game-screen { min-height: 100vh; display: flex; flex-direction: column; }
        .game-header { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.5rem; background: var(--color-surface); border-bottom: 1px solid var(--color-secondary); }
        .game-world-name { font-family: var(--font-main); color: var(--color-primary); font-size: 1.3rem; }
        .game-info { display: flex; gap: 1.5rem; color: var(--color-text-dim); font-size: 0.85rem; }
        .game-main { flex: 1; display: flex; gap: 1rem; padding: 1.5rem; overflow: hidden; }
        .narrative-panel { flex: 1; overflow-y: auto; padding-right: 1rem; }
        .intro-text { color: var(--color-text-dim); font-style: italic; font-size: 1.05rem; line-height: 1.8; }
        .player-action { color: var(--color-primary); margin: 0.75rem 0; font-weight: 600; }
        .world-narrative { color: var(--color-text); margin: 0.5rem 0 1rem; line-height: 1.7; }
        .thinking-indicator { color: var(--color-text-dim); font-style: italic; animation: pulse 1.5s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
        .action-error { color: var(--color-accent); font-size: 0.875rem; }

        .info-sidebar { width: 260px; border-left: 1px solid var(--color-secondary); padding-left: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; }
        .info-section h2 { font-size: 0.8rem; color: var(--color-text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.4rem; margin-top: 0; }
        .region-name { color: var(--color-primary); font-size: 1rem; font-weight: 600; margin: 0.25rem 0; }
        .region-desc { color: var(--color-text-dim); font-size: 0.8rem; line-height: 1.4; margin: 0; }
        .region-desc-sm { color: var(--color-text-dim); font-size: 0.7rem; }
        .region-list, .quest-list { list-style: none; padding: 0; margin: 0; }
        .region-list li { color: var(--color-text); font-size: 0.85rem; padding: 0.2rem 0; }
        .muted-text { color: var(--color-text-dim); font-size: 0.8rem; font-style: italic; margin: 0; }
        .quest-item { display: flex; justify-content: space-between; align-items: center; padding: 0.3rem 0; font-size: 0.82rem; }
        .quest-title { color: var(--color-text); }
        .quest-status { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; }
        .quest-active .quest-status { background: #3b82f620; color: #3b82f6; }
        .quest-completed .quest-status { background: #22c55e20; color: #22c55e; }
        .quest-failed .quest-status { background: #ef444420; color: #ef4444; }

        .npc-card { display: flex; flex-direction: column; padding: 0.5rem 0.6rem; margin-bottom: 0.3rem; background: var(--color-surface); border-radius: 6px; border: 1px solid var(--color-secondary); }
        .npc-card strong { color: var(--color-primary); font-size: 0.85rem; }
        .npc-role { color: var(--color-text-dim); font-size: 0.72rem; }
        .npc-mood { color: var(--color-text); font-size: 0.72rem; margin-top: 0.15rem; }

        .game-footer { padding: 0.75rem 1.5rem; background: var(--color-surface); border-top: 1px solid var(--color-secondary); }
        .action-form { display: flex; gap: 0.75rem; max-width: 800px; margin: 0 auto; }
        .action-input { flex: 1; padding: 0.65rem 0.9rem; border: 2px solid var(--color-secondary); border-radius: 8px; background: var(--color-bg); color: var(--color-text); font-size: 0.95rem; outline: none; transition: border-color 0.2s; }
        .action-input:focus { border-color: var(--color-primary); }
        .action-button { padding: 0.65rem 1.3rem; border: none; border-radius: 8px; background: var(--color-primary); color: var(--color-bg); font-size: 0.95rem; font-weight: 600; transition: opacity 0.2s; }
        .action-button:hover:not(:disabled) { opacity: 0.9; }
        .action-button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
