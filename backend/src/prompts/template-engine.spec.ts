/**
 * RFC-004: TemplateEngine 函数级单测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TemplateEngine } from './template-engine';

describe('TemplateEngine', () => {
  let tmpDir: string;
  let engine: TemplateEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-engine-test-'));
    // 创建层级目录
    fs.mkdirSync(path.join(tmpDir, 'gm', 'narrative'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'gm', 'narrative', 'system.md'),
      '## 世界设定\n{{worldDescription}}\n\n## 玩家\n{{playerName}}\n\n物品：{{inventory}}',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'gm', 'narrative', 'user.md'),
      '玩家行动：{{playerAction}}',
      'utf-8',
    );
    engine = new TemplateEngine(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('resolves dot notation to file path and loads content', () => {
      const tpl = engine.load('gm.narrative.system');
      expect(tpl.path).toBe('gm.narrative.system');
      expect(tpl.content).toContain('{{worldDescription}}');
      expect(tpl.placeholders).toContain('worldDescription');
      expect(tpl.placeholders).toContain('playerName');
      expect(tpl.placeholders).toContain('inventory');
    });

    it('caches loaded templates', () => {
      const tpl1 = engine.load('gm.narrative.system');
      const tpl2 = engine.load('gm.narrative.system');
      expect(tpl1).toBe(tpl2); // same reference
    });

    it('throws when template file does not exist', () => {
      expect(() => engine.load('nonexistent.path.template')).toThrow(
        'Template not found',
      );
    });
  });

  describe('render', () => {
    it('replaces all {{placeholder}} with provided params', () => {
      const result = engine.render('gm.narrative.system', {
        worldDescription: '一个奇幻世界',
        playerName: 'Alice',
        inventory: '木剑、药水',
      });
      expect(result).toContain('一个奇幻世界');
      expect(result).toContain('Alice');
      expect(result).toContain('木剑、药水');
      expect(result).not.toContain('{{');
    });

    it('throws when a placeholder is missing from params', () => {
      expect(() =>
        engine.render('gm.narrative.system', {
          worldDescription: 'test',
          // playerName missing
          inventory: 'none',
        }),
      ).toThrow(/missing params/);
    });

    it('ignores extra params not in template', () => {
      expect(() =>
        engine.render('gm.narrative.system', {
          worldDescription: 'test',
          playerName: 'Bob',
          inventory: '空',
          extraKey: 'ignored',
        }),
      ).not.toThrow();
    });

    it('supports schema validation with required fields', () => {
      const schema = {
        worldDescription: { type: 'string' as const, required: true, source: 'world_state' },
        playerName: { type: 'string' as const, required: true, source: 'player_state' },
        inventory: { type: 'string' as const, required: false, source: 'player_state' },
      };

      // missing required but in params
      expect(() =>
        engine.render(
          'gm.narrative.system',
          { worldDescription: 'test', playerName: 'Bob', inventory: 'x' },
          schema,
        ),
      ).not.toThrow();

      // required field present but empty → should fail
      expect(() =>
        engine.render(
          'gm.narrative.system',
          { worldDescription: 'test', playerName: '', inventory: 'x' },
          schema,
        ),
      ).toThrow(/missing required params/);
    });

    it('replaces placeholder occurrences multiple times in template', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'gm', 'narrative', 'repeat.md'),
        '名称：{{name}}，再次确认：{{name}}',
        'utf-8',
      );
      const result = engine.render('gm.narrative.repeat', { name: '龙' });
      expect(result).toBe('名称：龙，再次确认：龙');
    });

    it('clears cache on demand', () => {
      engine.load('gm.narrative.system');
      engine.clearCache();
      // re-load should work after clear
      const tpl = engine.load('gm.narrative.system');
      expect(tpl).toBeDefined();
    });

    it('handles template with no placeholders', () => {
      fs.mkdirSync(path.join(tmpDir, 'no'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'no', 'vars.md'),
        '固定内容，无占位符',
        'utf-8',
      );
      const result = engine.render('no.vars', {});
      expect(result).toBe('固定内容，无占位符');
    });
  });
});
