import { TagRenderer } from './TagRenderer.js';

interface NarrativeLineProps {
  type: 'player' | 'world' | 'system';
  text: string;
}

export function NarrativeLine({ type, text }: NarrativeLineProps) {
  if (type === 'player') {
    return <p className="text-primary font-semibold my-3">{text}</p>;
  }

  if (type === 'system') {
    return <TagRenderer text={text} />;
  }

  return <TagRenderer text={text} />;
}
