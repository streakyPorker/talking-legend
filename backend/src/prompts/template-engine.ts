/**
 * RFC-004: 模板引擎。
 *
 * 加载层级 .md 模板文件，执行 {{placeholder}} 替换，校验参数完整性。
 * dot notation 路径映射到文件系统：'gm.narrative.system' → 'templates/gm/narrative/system.md'
 */

import * as fs from 'fs';
import * as path from 'path';

/** 模板参数 schema 定义 */
export interface TemplateParamDef {
  type: 'string';
  required: boolean;
  source: string; // 数据来源模块名
}

export type TemplateParamsSchema = Record<string, TemplateParamDef>;

/** 加载后的模板，记录原始占位符列表 */
export interface Template {
  path: string; // dot notation 路径
  content: string; // 原始模板文本（含 {{placeholder}}）
  placeholders: string[]; // 所有占位符名
}

export class TemplateEngine {
  private readonly templatesDir: string;
  private cache = new Map<string, Template>();

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir;
  }

  /**
   * 将 dot notation 路径转为文件系统路径。
   * 'gm.narrative.system' → '<templatesDir>/gm/narrative/system.md'
   */
  private dotToFilePath(templatePath: string): string {
    const parts = templatePath.split('.');
    const dirParts = parts.slice(0, -1);
    const fileName = parts[parts.length - 1];
    return path.join(this.templatesDir, ...dirParts, `${fileName}.md`);
  }

  /** 提取模板中所有的 {{placeholder}} */
  private extractPlaceholders(content: string): string[] {
    const re = /\{\{(\w+)\}\}/g;
    const names: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      if (!names.includes(m[1])) {
        names.push(m[1]);
      }
    }
    return names;
  }

  /**
   * 加载模板文件，解析占位符。
   * 结果会缓存，同一路径只读一次文件。
   */
  load(templatePath: string): Template {
    const cached = this.cache.get(templatePath);
    if (cached) return cached;

    const filePath = this.dotToFilePath(templatePath);
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(
        `Template not found: "${templatePath}" (resolved to ${filePath}): ${(err as Error).message}`,
      );
    }

    const placeholders = this.extractPlaceholders(content);
    const template: Template = { path: templatePath, content, placeholders };
    this.cache.set(templatePath, template);
    return template;
  }

  /**
   * 加载模板 + 参数替换 + 校验。
   *
   * - required:true 的占位符缺失 → 抛错
   * - 模板中存在但 params 未提供的占位符 → 抛错（不静默忽略）
   * - params 中多余的 key 被忽略（不报错）
   */
  render(
    templatePath: string,
    params: Record<string, string>,
    schema?: TemplateParamsSchema,
  ): string {
    const template = this.load(templatePath);

    // 校验：模板中所有占位符必须在 params 中
    const missing: string[] = [];
    for (const ph of template.placeholders) {
      if (!(ph in params)) {
        missing.push(ph);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Template "${templatePath}" missing params: ${missing.join(', ')}`,
      );
    }

    // schema 校验：required 字段必须有非空值
    if (schema) {
      const requiredMissing: string[] = [];
      for (const [key, def] of Object.entries(schema)) {
        if (def.required && (!(key in params) || params[key].trim() === '')) {
          requiredMissing.push(key);
        }
      }
      if (requiredMissing.length > 0) {
        throw new Error(
          `Template "${templatePath}" missing required params: ${requiredMissing.join(', ')}`,
        );
      }
    }

    // 替换 {{placeholder}}
    let result = template.content;
    for (const ph of template.placeholders) {
      result = result.replace(new RegExp(`\\{\\{${ph}\\}\\}`, 'g'), params[ph]);
    }

    return result;
  }

  /** 清空缓存（主要用于测试） */
  clearCache(): void {
    this.cache.clear();
  }
}
