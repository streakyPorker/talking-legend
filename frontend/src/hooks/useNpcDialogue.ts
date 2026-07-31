import { useState, useCallback } from 'react';
import { talkToNpcStream, submitNpcSummary } from '../services/api.js';

export interface NpcMessage {
  role: 'player' | 'npc';
  content: string;
}

export function useNpcDialogue(playerName: string) {
  const [messages, setMessages] = useState<NpcMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (npcId: string, gameId: string, text: string): Promise<NpcMessage[]> => {
      if (!text.trim() || isLoading) return messages;

      setIsLoading(true);
      setIsStreaming(true);
      setError(null);

      // 1. Add player message to local state
      const playerMsg: NpcMessage = { role: 'player', content: text };
      setMessages((prev) => [...prev, playerMsg]);

      // 2. Add an empty NPC bubble for streaming
      setMessages((prev) => [...prev, { role: 'npc', content: '' }]);

      try {
        const reader = await talkToNpcStream(gameId, npcId, text);
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let npcResponse = '';

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
              npcResponse += data.content;
              // Append to the last NPC bubble
              setMessages((prev) => {
                const next = [...prev];
                if (next.length > 0 && next[next.length - 1].role === 'npc') {
                  next[next.length - 1] = { role: 'npc', content: npcResponse };
                }
                return next;
              });
            } else if (data.type === 'done') {
              // 4. Fire summary (fire-and-forget)
              const allMessages = [
                ...messages,
                playerMsg,
                { role: 'assistant', content: npcResponse } as const,
              ];
              submitNpcSummary(
                gameId,
                npcId,
                allMessages.map((m) => ({
                  role: m.role === 'player' ? 'user' : 'assistant',
                  content: m.content,
                })),
                playerName,
              );
            } else if (data.type === 'error') {
              setError(data.message);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '对话失败');
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
      }

      return messages;
    },
    [isLoading, messages, playerName],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
    setIsLoading(false);
    setIsStreaming(false);
  }, []);

  return { messages, isLoading, isStreaming, error, sendMessage, reset };
}
