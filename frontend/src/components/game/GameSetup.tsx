import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { createGame } from '../../services/api.js';
import { useGameStore } from '../../stores/gameStore.js';
import { Button } from '../ui/Button.js';
import { Input } from '../ui/Input.js';

interface GameSetupProps {
  onOpenConfig: () => void;
}

export function GameSetup({ onOpenConfig }: GameSetupProps) {
  const [playerName, setPlayerName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setGameState = useGameStore((s) => s.setGameState);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!playerName.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await createGame(playerName.trim());
      setGameState(result.initialState);
      navigate(`/game/${result.gameId}`, {
        state: { gameState: result.initialState },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法开始游戏');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-base-100 to-base-200 p-8">
      <Button
        variant="circle"
        onClick={onOpenConfig}
        ariaLabel="打开配置"
        className="fixed top-3 right-3 z-50 text-2xl"
      >
        ⚙
      </Button>

      <div className="max-w-md w-full text-center">
        <h1 className="font-title text-primary text-4xl mb-2">传说之语</h1>
        <p className="text-base-content/60 mb-8 leading-relaxed">
          言语即是力量。你的话语将塑造这个世界，你的选择将决定命运的方向。
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            id="player-name"
            label="勇者，请留下你的名字："
            value={playerName}
            onChange={setPlayerName}
            placeholder="输入姓名…"
            disabled={isLoading}
            autoFocus
          />

          {error && <p className="text-error text-sm">{error}</p>}

          <Button
            type="submit"
            variant="primary"
            disabled={isLoading || !playerName.trim()}
            loading={isLoading}
          >
            {isLoading ? '命运之轮转动中…' : '开启传奇'}
          </Button>
        </form>
      </div>
    </div>
  );
}
