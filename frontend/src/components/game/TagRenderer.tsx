import { renderMarkdown } from '../../utils/markdown.js';
import { parseXmlTags, type XmlNode } from '../../utils/xml-parser.js';
import { regionCN } from '../../utils/i18n.js';

/** 将含 XML 标签的 LLM 输出渲染为组件 */
export function TagRenderer({ text }: { text: string }) {
  const nodes = parseXmlTags(text);
  if (nodes.length === 0) return null;

  return (
    <>
      {nodes.map((node, i) => (
        <TagNode key={i} node={node} />
      ))}
    </>
  );
}

function TagNode({ node }: { node: XmlNode }) {
  switch (node.tag) {
    case 'narration':
      return <div className="text-base-content my-2 mb-4 leading-relaxed">{renderMarkdown(node.content)}</div>;

    case 'move': {
      const targetName = node.attr?.to ? regionCN(node.attr.to) : node.content;
      return (
        <div className="my-4 p-3 rounded-lg bg-success/10 border border-success/20 text-sm text-success/90 leading-relaxed">
          <span className="inline-block mr-1.5">🗺️</span>
          前往 <strong>{targetName}</strong>
          {node.content && node.content !== targetName && ` — ${node.content}`}
        </div>
      );
    }

    case 'dialogue': {
      const speaker = node.attr?.speaker || '???';
      return (
        <blockquote className="my-3 pl-4 border-l-4 border-accent/40 italic text-accent/90">
          <span className="not-italic font-semibold text-sm text-accent mr-2">「{speaker}」</span>
          {renderMarkdown(node.content)}
        </blockquote>
      );
    }

    case 'event': {
      const icon = node.attr?.type === 'weather' ? '🌤️' : node.attr?.type === 'time' ? '🕐' : '⚡';
      return (
        <div className="my-3 p-2 rounded bg-warning/10 border border-warning/20 text-sm text-warning/90">
          <span className="mr-1.5">{icon}</span>
          {renderMarkdown(node.content)}
        </div>
      );
    }

    case 'system':
      return (
        <div className="my-2 p-2 rounded bg-info/10 border border-info/20 text-sm text-info/90">
          <span className="mr-1.5">⚙</span>
          {renderMarkdown(node.content)}
        </div>
      );

    default:
      return <p className="text-base-content my-2">{node.content}</p>;
  }
}
