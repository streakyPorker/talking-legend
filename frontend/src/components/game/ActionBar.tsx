import { useState, type FormEvent } from 'react';
import { Input } from '../ui/Input.js';
import { Button } from '../ui/Button.js';

interface ActionBarProps {
  onSubmit: (action: string) => void;
  isLoading: boolean;
}

export function ActionBar({ onSubmit, isLoading }: ActionBarProps) {
  const [input, setInput] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSubmit(input.trim());
    setInput('');
  };

  return (
    <footer className="px-6 py-3 bg-base-200 border-t border-base-300">
      <form onSubmit={handleSubmit} className="flex gap-3 max-w-[800px] mx-auto items-end">
        <div className="flex-1">
          <Input
            value={input}
            onChange={setInput}
            placeholder="你想做什么？"
            disabled={isLoading}
            autoFocus
          />
        </div>
        <Button
          type="submit"
          variant="primary"
          disabled={isLoading || !input.trim()}
        >
          行动
        </Button>
      </form>
    </footer>
  );
}
