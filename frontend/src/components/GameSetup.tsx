import { useState, type FormEvent } from 'react';
import type { GameState } from '@talking-legend/shared';
import { createGame } from '../services/api.js';

interface GameSetupProps {
  onGameStart: (state: GameState) => void;
}

export function GameSetup({ onGameStart }: GameSetupProps) {
  const [playerName, setPlayerName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!playerName.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await createGame(playerName.trim());
      onGameStart(result.initialState);
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法开始游戏');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="game-setup">
      <div className="setup-card">
        <h1 className="setup-title">传说之语</h1>
        <p className="setup-subtitle">
          言语即是力量。你的话语将塑造这个世界，你的选择将决定命运的方向。
        </p>

        <form onSubmit={handleSubmit} className="setup-form">
          <label htmlFor="player-name" className="setup-label">
            勇者，请留下你的名字：
          </label>
          <input
            id="player-name"
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="输入姓名…"
            className="setup-input"
            disabled={isLoading}
            autoFocus
          />

          {error && <p className="setup-error">{error}</p>}

          <button
            type="submit"
            className="setup-button"
            disabled={isLoading || !playerName.trim()}
          >
            {isLoading ? '命运之轮转动中…' : '开启传奇'}
          </button>
        </form>
      </div>

      <style>{`
        .game-setup {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, var(--color-bg) 0%, var(--color-surface) 100%);
          padding: 2rem;
        }
        .setup-card {
          max-width: 480px;
          width: 100%;
          text-align: center;
        }
        .setup-title {
          font-family: var(--font-main);
          font-size: 2.5rem;
          color: var(--color-primary);
          margin-bottom: 0.5rem;
        }
        .setup-subtitle {
          color: var(--color-text-dim);
          margin-bottom: 2rem;
          line-height: 1.7;
        }
        .setup-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .setup-label {
          font-size: 1rem;
          color: var(--color-text);
        }
        .setup-input {
          padding: 0.75rem 1rem;
          border: 2px solid var(--color-secondary);
          border-radius: 8px;
          background: var(--color-bg);
          color: var(--color-text);
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .setup-input:focus {
          border-color: var(--color-primary);
        }
        .setup-error {
          color: var(--color-accent);
          font-size: 0.875rem;
        }
        .setup-button {
          padding: 0.75rem 1.5rem;
          border: none;
          border-radius: 8px;
          background: var(--color-primary);
          color: var(--color-bg);
          font-size: 1.1rem;
          font-weight: 600;
          transition: opacity 0.2s;
        }
        .setup-button:hover:not(:disabled) {
          opacity: 0.9;
        }
        .setup-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
