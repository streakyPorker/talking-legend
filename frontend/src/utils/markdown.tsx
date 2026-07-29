/** 简易 markdown 渲染：支持 **粗体**、*斜体*、`代码` */
export function renderMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i}>{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="bg-base-300 px-1 rounded text-sm">{part.slice(1, -1)}</code>;
    return part;
  });
}
