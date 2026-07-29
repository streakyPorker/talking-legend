import { renderMarkdown } from '../../utils/markdown.js';

interface NarrativeLineProps {
  type: 'player' | 'world';
  text: string;
}

export function NarrativeLine({ type, text }: NarrativeLineProps) {
  if (type === 'player') {
    return <p className="text-primary font-semibold my-3">{text}</p>;
  }

  const paras = text.split('\n\n');
  return (
    <div className="text-base-content my-2 mb-4 leading-relaxed">
      {paras.map((p, j) => (
        <p key={j}>{renderMarkdown(p)}</p>
      ))}
    </div>
  );
}
