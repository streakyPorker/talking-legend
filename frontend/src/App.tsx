import { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { GameSetup } from './components/GameSetup.js';
import { GameScreen } from './components/GameScreen.js';
import { ConfigScreen } from './components/ConfigScreen.js';

export function App() {
  const [showConfig, setShowConfig] = useState(false);

  // 按 Esc 关闭配置面板
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConfig(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const openConfig = () => setShowConfig(true);

  return (
    <>
      <Routes>
        <Route path="/" element={<GameSetup onOpenConfig={openConfig} />} />
        <Route path="/game/:gameId" element={<GameScreen onOpenConfig={openConfig} />} />
      </Routes>

      {showConfig && <ConfigScreen onClose={() => setShowConfig(false)} />}
    </>
  );
}
