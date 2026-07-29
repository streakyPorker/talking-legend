import { useState, useCallback } from 'react';
import { useGameStore } from '../stores/gameStore.js';
import { performActionStream } from '../services/api.js';

export function useGameAction() {
  const gameState = useGameStore((s) => s.gameState);
  const addPlayerAction = useGameStore((s) => s.addPlayerAction);
  const appendNarrativeChunk = useGameStore((s) => s.appendNarrativeChunk);
  const updateTurn = useGameStore((s) => s.updateTurn);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolToast, setToolToast] = useState<{ message: string } | null>(null);

  const execute = useCallback(
    async (actionText: string) => {
      if (!gameState || isLoading) return;

      setIsLoading(true);
      setError(null);
      addPlayerAction(actionText);

      try {
        const reader = await performActionStream(gameState.id, actionText);
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
              appendNarrativeChunk(data.content);
            } else if (data.type === 'done') {
              updateTurn(data.turn);
              // playtest record (fire-and-forget)
              fetch('/api/playtest/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  worldId: 'aethelgard',
                  playerName: gameState.player.name,
                  action: actionText,
                  narrative: data.narrative ?? '',
                  turn: data.turn,
                  tokenEstimate: data.tokenEstimate,
                }),
              }).catch(() => {});
            } else if (data.type === 'error') {
              setError(data.message);
            } else if (data.type === 'tool_call') {
              // Set tool toast — show "正在前往..."
              setToolToast({ message: `正在前往${data.args?.target ?? '...'}…` });
            } else if (data.type === 'tool_result') {
              setToolToast(null);
              if (data.success && data.stateChanges?.gameState) {
                const gs = data.stateChanges.gameState;
                useGameStore.getState().setGameState(gs);
                // Also append tool result message to narrative
                useGameStore.getState().addToolResult(data.message);
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '行动失败');
      } finally {
        setIsLoading(false);
      }
    },
    [gameState, isLoading, addPlayerAction, appendNarrativeChunk, updateTurn],
  );

  return { execute, isLoading, error, toolToast };
}
