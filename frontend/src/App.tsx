import { useState } from 'react';
import type { GameState } from '@talking-legend/shared';
import { GameSetup } from './components/GameSetup.js';
import { GameScreen } from './components/GameScreen.js';

export function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);

  if (!gameState) {
    return <GameSetup onGameStart={setGameState} />;
  }

  return <GameScreen gameState={gameState} onGameUpdate={setGameState} />;
}
