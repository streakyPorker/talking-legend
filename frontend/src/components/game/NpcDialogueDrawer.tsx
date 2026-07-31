import { useState, useEffect, useRef, useCallback } from 'react';
import type { NPCState } from '@talking-legend/shared';
import { useNpcDialogue, type NpcMessage } from '../../hooks/useNpcDialogue.js';
import { getNpcMemories, type NpcMemory } from '../../services/api.js';
import { TagRenderer } from './TagRenderer.js';

interface NpcDialogueDrawerProps {
  npc: (Pick<NPCState, 'id' | 'name' | 'role' | 'currentMood'>) | null;
  gameId: string;
  isOpen: boolean;
  onClose: () => void;
  playerName: string;
}

const moodEmoji: Record<string, string> = {
  neutral: '\u{1F610}',
  happy: '\u{1F60A}',
  angry: '\u{1F620}',
  sad: '\u{1F622}',
  fearful: '\u{1F628}',
};

function getMoodEmoji(mood: string): string {
  const key = mood.toLowerCase().trim();
  return moodEmoji[key] || '\u{1F610}';
}

export function NpcDialogueDrawer({ npc, gameId, isOpen, onClose, playerName }: NpcDialogueDrawerProps) {
  const { messages, isLoading, isStreaming, error, sendMessage, reset } = useNpcDialogue(playerName);
  const [input, setInput] = useState('');
  const [memories, setMemories] = useState<NpcMemory[]>([]);
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load memories when drawer opens
  useEffect(() => {
    if (isOpen && npc) {
      getNpcMemories(gameId, npc.id)
        .then((m) => setMemories(m))
        .catch(() => setMemories([]));
    }
  }, [isOpen, npc?.id, gameId]);

  // Reset state when drawer opens
  useEffect(() => {
    if (isOpen) {
      reset();
      setInput('');
    }
  }, [isOpen, reset]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    if (!npc || !input.trim() || isLoading) return;
    const text = input;
    setInput('');
    await sendMessage(npc.id, gameId, text);
  }, [npc, input, isLoading, sendMessage, gameId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Determine latest memory for collapsed preview
  const latestMemory = memories.length > 0
    ? [...memories].sort((a, b) => b.importance - a.importance)[0]
    : null;

  if (!npc) return null;

  return (
    <div
      className={`fixed right-0 top-0 h-full w-[380px] bg-base-100 border-l shadow-xl z-40 flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="bg-base-200 p-3 flex items-start justify-between border-b border-base-300 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base truncate">{npc.name}</h3>
            <span className="text-lg">{getMoodEmoji(npc.currentMood)}</span>
          </div>
          <p className="text-xs text-base-content/60">{npc.role}</p>

          {/* Collapsible memories */}
          {latestMemory && (
            <div className="mt-1">
              <button
                className="text-xs text-info/70 hover:text-info cursor-pointer"
                onClick={() => setMemoriesOpen(!memoriesOpen)}
              >
                {memoriesOpen ? '收起记忆' : '记忆 ' + '\u{1F4AD}'}
              </button>
              {memoriesOpen && (
                <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                  {[...memories]
                    .sort((a, b) => b.importance - a.importance)
                    .map((mem) => (
                      <p key={mem.id} className="text-[11px] text-base-content/50 leading-tight">
                        {mem.content}
                      </p>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          className="btn btn-ghost btn-xs btn-square text-base-content/60 hover:text-base-content"
          onClick={handleClose}
          aria-label="关闭对话"
        >
          ✕
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !isLoading && (
          <div className="text-sm text-base-content/40 text-center mt-8">
            开始与 {npc.name} 对话
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat ${msg.role === 'npc' ? 'chat-start' : 'chat-end'}`}>
            <div className="chat-header text-xs text-base-content/50 mb-0.5">
              {msg.role === 'npc' ? npc.name : playerName}
            </div>
            <div
              className={`chat-bubble max-w-[85%] ${
                msg.role === 'npc'
                  ? 'bg-neutral text-neutral-content'
                  : 'bg-primary text-primary-content'
              }`}
            >
              {msg.role === 'npc' ? <TagRenderer text={msg.content} /> : msg.content}
              {/* Streaming cursor */}
              {isStreaming && i === messages.length - 1 && msg.role === 'npc' && msg.content === '' && (
                <span className="animate-pulse">...</span>
              )}
            </div>
          </div>
        ))}
        {error && (
          <div className="alert alert-error text-sm py-2">{error}</div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <div className="p-3 border-t border-base-300 bg-base-200 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            className="textarea textarea-bordered textarea-sm flex-1 min-h-[36px] max-h-[96px] resize-none text-sm"
            placeholder="输入对话..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? (
              <span className="loading loading-spinner loading-xs"></span>
            ) : (
              '发送'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
