/** XML 标签解析器 — 将 LLM 结构化输出解析为 React 组件用的数据节点 */

export interface XmlNode {
  tag: 'narration' | 'move' | 'dialogue' | 'event' | 'system';
  content: string;
  attr?: Record<string, string>;
}

/**
 * 解析含 XML 标签的文本为 XmlNode 数组。
 * 支持的标签：<narration> <move to="id"> <dialogue speaker="name"> <event type="t"> <system>
 */
export function parseXmlTags(text: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  const regex = /<(\/?)(narration|move|dialogue|event|system)(\s[^>]*)?>([^<]*)<\/(narration|move|dialogue|event|system)>/gs;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before this tag → narration
    const before = text.slice(lastIndex, match.index).trim();
    if (before) {
      nodes.push({ tag: 'narration', content: before });
    }

    const tag = match[2] as XmlNode['tag'];
    const attrStr = match[3] || '';
    const content = match[4].trim();
    const attr = parseAttrs(attrStr);
    nodes.push({ tag, content, attr: Object.keys(attr).length ? attr : undefined });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text → narration
  const after = text.slice(lastIndex).trim();
  if (after) {
    nodes.push({ tag: 'narration', content: after });
  }

  // If no tags found at all, treat entire text as narration
  if (nodes.length === 0 && text.trim()) {
    nodes.push({ tag: 'narration', content: text.trim() });
  }

  return nodes;
}

/** 解析属性字符串 key="value" */
function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}
