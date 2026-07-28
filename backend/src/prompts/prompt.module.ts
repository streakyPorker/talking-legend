import { Module } from '@nestjs/common';
import { TemplateEngine } from './template-engine';
import * as path from 'path';

/**
 * PromptModule — 提供 TemplateEngine 单例。
 *
 * 模板路径决策：
 * - SWC 编译 src → dist，但不会复制 .md 文件。
 * - dev 模式下 process.cwd() = backend/，直接读 src/prompts/templates/ 即可。
 * - 生产部署时需确保 templates 目录随包发布（如通过 copyfiles 脚本或 Docker COPY）。
 */
@Module({
  providers: [
    {
      provide: TemplateEngine,
      useFactory: () => {
        const templatesDir = path.resolve(process.cwd(), 'src', 'prompts', 'templates');
        return new TemplateEngine(templatesDir);
      },
    },
  ],
  exports: [TemplateEngine],
})
export class PromptModule {}
