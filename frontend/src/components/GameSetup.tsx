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
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="game-setup">
      <div className="setup-card">
        <h1 className="setup-title">Talking Legend</h1>
        <p className="setup-subtitle">
          Enter a world where your words shape destiny. Speak, explore, and
          become the legend you were meant to be.
        </p>

        <form onSubmit={handleSubmit} className="setup-form">
          <label htmlFor="player-name" className="setup-label">
            What is your name, adventurer?
          </label>
          <input
            id="player-name"
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name..."
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
            {isLoading ? 'Preparing your adventure...' : 'Begin Your Legend'}
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
