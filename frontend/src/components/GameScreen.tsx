import { useState, type FormEvent } from 'react';
import type { GameState } from '@talking-legend/shared';
import { performAction } from '../services/api.js';

interface GameScreenProps {
  gameState: GameState;
  onGameUpdate: (state: GameState) => void;
}

export function GameScreen({ gameState, onGameUpdate }: GameScreenProps) {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [narrative, setNarrative] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const actionText = input.trim();
    setInput('');
    setIsLoading(true);
    setError(null);

    // Show player action immediately
    setNarrative((prev) => [...prev, `> ${actionText}`]);

    try {
      const result = await performAction(gameState.id, actionText);
      setNarrative((prev) => [...prev, result.narrative]);
      onGameUpdate(result.updatedState);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="game-screen">
      {/* Header */}
      <header className="game-header">
        <h1 className="game-world-name">{gameState.world.name}</h1>
        <div className="game-info">
          <span>{gameState.world.currentRegion} · Turn {gameState.turn}</span>
          <span>{gameState.world.timeOfDay} · {gameState.world.weather}</span>
        </div>
      </header>

      {/* Main narrative area */}
      <main className="game-main">
        <div className="narrative-panel">
          {narrative.length === 0 && (
            <p className="intro-text">
              You stand at the edge of {gameState.world.currentRegion === 'village' ? 'Stoneshire Village' : gameState.world.currentRegion}, {gameState.player.name}.
              The world stretches before you, full of untold stories.
              What will you do?
            </p>
          )}
          {narrative.map((line, i) => (
            <p
              key={i}
              className={line.startsWith('>') ? 'player-action' : 'world-narrative'}
            >
              {line}
            </p>
          ))}
          {isLoading && <p className="thinking-indicator">The world responds...</p>}
          {error && <p className="action-error">{error}</p>}
        </div>

        {/* NPC sidebar */}
        <aside className="npc-sidebar">
          <h2>Characters Nearby</h2>
          {gameState.npcs
            .filter((npc) => npc.location === gameState.world.currentRegion)
            .map((npc) => (
              <div key={npc.id} className="npc-card">
                <strong>{npc.name}</strong>
                <span className="npc-role">{npc.role}</span>
                <span className="npc-mood">{npc.currentMood}</span>
              </div>
            ))}
        </aside>
      </main>

      {/* Input area */}
      <footer className="game-footer">
        <form onSubmit={handleAction} className="action-form">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What will you do next?"
            className="action-input"
            disabled={isLoading}
            autoFocus
          />
          <button
            type="submit"
            className="action-button"
            disabled={isLoading || !input.trim()}
          >
            Act
          </button>
        </form>
      </footer>

      <style>{`
        .game-screen {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .game-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem 2rem;
          background: var(--color-surface);
          border-bottom: 1px solid var(--color-secondary);
        }
        .game-world-name {
          font-family: var(--font-main);
          color: var(--color-primary);
          font-size: 1.5rem;
        }
        .game-info {
          display: flex;
          gap: 1.5rem;
          color: var(--color-text-dim);
          font-size: 0.875rem;
        }
        .game-main {
          flex: 1;
          display: flex;
          gap: 1rem;
          padding: 1.5rem 2rem;
          overflow: hidden;
        }
        .narrative-panel {
          flex: 1;
          overflow-y: auto;
          padding-right: 1rem;
        }
        .intro-text {
          color: var(--color-text-dim);
          font-style: italic;
          font-size: 1.05rem;
          line-height: 1.8;
        }
        .player-action {
          color: var(--color-primary);
          margin: 0.75rem 0;
          font-weight: 600;
        }
        .world-narrative {
          color: var(--color-text);
          margin: 0.5rem 0 1rem;
          line-height: 1.7;
        }
        .thinking-indicator {
          color: var(--color-text-dim);
          font-style: italic;
          animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        .action-error {
          color: var(--color-accent);
          font-size: 0.875rem;
        }
        .npc-sidebar {
          width: 240px;
          border-left: 1px solid var(--color-secondary);
          padding-left: 1rem;
        }
        .npc-sidebar h2 {
          font-size: 0.875rem;
          color: var(--color-text-dim);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 1rem;
        }
        .npc-card {
          display: flex;
          flex-direction: column;
          padding: 0.75rem;
          margin-bottom: 0.5rem;
          background: var(--color-surface);
          border-radius: 6px;
          border: 1px solid var(--color-secondary);
        }
        .npc-card strong {
          color: var(--color-primary);
          font-size: 0.95rem;
        }
        .npc-role {
          color: var(--color-text-dim);
          font-size: 0.8rem;
        }
        .npc-mood {
          color: var(--color-text);
          font-size: 0.8rem;
          margin-top: 0.25rem;
        }
        .game-footer {
          padding: 1rem 2rem;
          background: var(--color-surface);
          border-top: 1px solid var(--color-secondary);
        }
        .action-form {
          display: flex;
          gap: 0.75rem;
          max-width: 800px;
          margin: 0 auto;
        }
        .action-input {
          flex: 1;
          padding: 0.75rem 1rem;
          border: 2px solid var(--color-secondary);
          border-radius: 8px;
          background: var(--color-bg);
          color: var(--color-text);
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .action-input:focus {
          border-color: var(--color-primary);
        }
        .action-button {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 8px;
          background: var(--color-primary);
          color: var(--color-bg);
          font-size: 1rem;
          font-weight: 600;
          transition: opacity 0.2s;
        }
        .action-button:hover:not(:disabled) {
          opacity: 0.9;
        }
        .action-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
