import React from 'react';

/** Markdown → JSX 渲染：支持标题、列表、粗体、斜体、代码、分隔线 */
export function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行 → 段落分隔
    if (!line.trim()) {
      nodes.push(<br key={`br-${i}`} />);
      i++;
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      const cls = level === 1 ? 'text-xl font-bold' : level === 2 ? 'text-lg font-semibold' : 'text-base font-medium';
      nodes.push(<Tag key={i} className={cls}>{inlineSpan(heading[2])}</Tag>);
      i++;
      continue;
    }

    // 无序列表
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      nodes.push(
        <ul key={`ul-${i}`} className="list-disc list-inside my-1 space-y-0.5">
          {items.map((item, j) => (
            <li key={j}>{inlineSpan(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // 分隔线
    if (/^[-*_]{3,}$/.test(line.trim())) {
      nodes.push(<hr key={i} className="my-2 border-base-300" />);
      i++;
      continue;
    }

    // 普通段落
    nodes.push(<p key={i} className="my-0.5">{inlineSpan(line)}</p>);
    i++;
  }

  return nodes;
}

/** 行内样式：**粗体**、*斜体*、`代码` */
function inlineSpan(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|\*[^*].*?[^*]\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="bg-base-300 px-1 rounded text-sm">{part.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}
