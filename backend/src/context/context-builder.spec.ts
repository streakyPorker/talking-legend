/**
 * RFC-004: ContextBuilder 模块级单测
 * 测试组装 + trim + fail fast 逻辑。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ContextModule, GatherContext, ModuleData, Granularity } from './context-module.interface';
import {
  GMContextBuilder,
  NpcContextBuilder,
  IntentContextBuilder,
  EventContextBuilder,
} from './context-builder';
import { ContextBudgetExceededError } from './context-budget.error';

// ─── 测试用 Mock 模块 ─────────────────────────────────────

class MockModule implements ContextModule {
  readonly name: string;
  readonly mandatory: boolean;
  private content: string;
  private compactContent: string;
  private minimalContent: string;

  constructor(
    name: string,
    mandatory: boolean,
    content: string,
    compact?: string,
    minimal?: string,
  ) {
    this.name = name;
    this.mandatory = mandatory;
    this.content = content;
    this.compactContent = compact ?? content.slice(0, Math.ceil(content.length / 3));
    this.minimalContent = minimal ?? content.slice(0, 10);
  }

  async gather(_ctx: GatherContext): Promise<ModuleData> {
    return {
      structured: { text: this.content },
      tokenEstimate: Math.ceil(this.content.length / 2),
    };
  }

  render(data: ModuleData): string {
    return this.granularity.full(data);
  }

  renderWith(data: ModuleData, template: string): string {
    return template;
  }

  get granularity(): Granularity {
    return {
      full: () => this.content,
      compact: () => this.compactContent,
      minimal: () => this.minimalContent,
    };
  }
}

function makeRegistry(modules: MockModule[]): Map<string, ContextModule> {
  const map = new Map<string, ContextModule>();
  for (const m of modules) map.set(m.name, m);
  return map;
}

// ─── 测试 ─────────────────────────────────────────────────

describe('GMContextBuilder', () => {
  it('assembles modules from gm_narrative config', async () => {
    const worldMod = new MockModule('world_state', true, 'WORLD_STATE_CONTENT');
    const playerMod = new MockModule('player_state', false, 'PLAYER_CONTENT');
    const historyMod = new MockModule('narrative_history', false, 'HISTORY_CONTENT');
    const eventsMod = new MockModule('active_events', false, 'EVENTS_CONTENT');
    const hintMod = new MockModule('scenario_hint', false, 'HINT_CONTENT');

    const registry = makeRegistry([worldMod, playerMod, historyMod, eventsMod, hintMod]);
    const builder = new GMContextBuilder(registry);

    const result = await builder.build('game-1', 10000);

    expect(result.systemPrompt).toContain('WORLD_STATE_CONTENT');
    expect(result.systemPrompt).toContain('PLAYER_CONTENT');
    expect(result.systemPrompt).toContain('HISTORY_CONTENT');
    expect(result.systemPrompt).toContain('EVENTS_CONTENT');
    expect(result.systemPrompt).toContain('HINT_CONTENT');
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it('throws when mandatory module is missing from registry', async () => {
    const registry = makeRegistry([]);
    const builder = new GMContextBuilder(registry);
    await expect(builder.build('game-1', 10000)).rejects.toThrow('not found in registry');
  });
});

describe('NpcContextBuilder', () => {
  it('assembles modules from npc_dialogue config', async () => {
    const worldMod = new MockModule('world_state', true, 'WORLD');
    const personaMod = new MockModule('npc_persona', true, 'PERSONA');
    const memoryMod = new MockModule('npc_memory', false, 'MEMORY');
    const playerMod = new MockModule('player_state', false, 'PLAYER');
    const historyMod = new MockModule('narrative_history', false, 'HISTORY');
    const eventsMod = new MockModule('active_events', false, 'EVENTS');

    const registry = makeRegistry([worldMod, personaMod, memoryMod, playerMod, historyMod, eventsMod]);
    const builder = new NpcContextBuilder(registry);

    const result = await builder.build('game-2', 10000);
    expect(result.systemPrompt).toContain('WORLD');
    expect(result.systemPrompt).toContain('PERSONA');
  });

  it('throws when mandatory persona module is missing', async () => {
    const registry = makeRegistry([new MockModule('world_state', true, 'W')]);
    const builder = new NpcContextBuilder(registry);
    await expect(builder.build('game-1', 10000)).rejects.toThrow('not found in registry');
  });
});

describe('IntentContextBuilder', () => {
  it('assembles only intent-specific modules', async () => {
    const worldMod = new MockModule('world_state', true, 'WORLD');
    const intentMod = new MockModule('intent_input', true, 'INTENT');

    const registry = makeRegistry([worldMod, intentMod]);
    const builder = new IntentContextBuilder(registry);

    const result = await builder.build('game-3', 10000);
    expect(result.systemPrompt).toContain('WORLD');
    expect(result.systemPrompt).toContain('INTENT');
  });
});

describe('EventContextBuilder', () => {
  it('assembles world state and active events', async () => {
    const worldMod = new MockModule('world_state', true, 'WORLD');
    const eventsMod = new MockModule('active_events', false, 'EVENTS');

    const registry = makeRegistry([worldMod, eventsMod]);
    const builder = new EventContextBuilder(registry);

    const result = await builder.build('game-4', 10000);
    expect(result.systemPrompt).toContain('WORLD');
    expect(result.systemPrompt).toContain('EVENTS');
  });
});

describe('Trim / budget handling', () => {
  it('downgrades non-mandatory modules when budget is tight', async () => {
    const worldMod = new MockModule('world_state', true, 'X'.repeat(100));  // ~50 tokens
    // Create a large optional module that will need downgrading
    const playerMod = new MockModule(
      'player_state', false,
      'FULL'.repeat(100),   // 400 chars → ~200 tokens
      'COMPACT',             // 7 chars → ~4 tokens
      'MIN',                 // 3 chars → ~2 tokens
    );
    // GM config requires all 5 modules — provide stubs for the rest
    const historyMod = new MockModule('narrative_history', false, 'HISTORY'); // ~4 tokens
    const eventsMod = new MockModule('active_events', false, 'EVENTS');       // ~3 tokens
    const hintMod = new MockModule('scenario_hint', false, 'HINT');           // ~2 tokens

    const registry = makeRegistry([worldMod, playerMod, historyMod, eventsMod, hintMod]);
    const builder = new GMContextBuilder(registry);

    // Budget: mandatory(50) + 4 optionals(200+4+3+2=209) = 259 (full)
    // Budget 70 → large optional must be downgraded to compact
    // After player downgrade to compact: 50 + 4 + 4 + 3 + 2 = 63 ≤ 70 OK
    const result = await builder.build('game-1', 70);

    // The optional module should have been downgraded to compact
    expect(result.systemPrompt).toContain('COMPACT');
    expect(result.systemPrompt).not.toContain('FULL'.repeat(100));
  });

  it('throws ContextBudgetExceededError when mandatory modules alone exceed budget', async () => {
    const hugeMod = new MockModule('world_state', true, 'X'.repeat(2000)); // ~1000 tokens
    const playerMod = new MockModule('player_state', false, 'P');
    const historyMod = new MockModule('narrative_history', false, 'H');
    const eventsMod = new MockModule('active_events', false, 'E');
    const hintMod = new MockModule('scenario_hint', false, 'S');
    const registry = makeRegistry([hugeMod, playerMod, historyMod, eventsMod, hintMod]);
    const builder = new GMContextBuilder(registry);

    await expect(builder.build('game-1', 100)).rejects.toThrow(
      ContextBudgetExceededError,
    );
  });

  it('throws budget error when all optional are minimal but still over budget', async () => {
    const hugeMandatory = new MockModule('world_state', true, 'X'.repeat(600)); // ~300 tokens
    const opt1 = new MockModule('player_state', false, 'Y'.repeat(200), 'YYY', 'Y'); // min: 1 char → 1 token
    const opt2 = new MockModule('narrative_history', false, 'Z'.repeat(200), 'ZZZ', 'Z');
    const opt3 = new MockModule('active_events', false, 'W'.repeat(200), 'WWW', 'W');
    const opt4 = new MockModule('scenario_hint', false, 'V'.repeat(200), 'VVV', 'V');

    const registry = makeRegistry([hugeMandatory, opt1, opt2, opt3, opt4]);
    const builder = new GMContextBuilder(registry);

    // mandatory ~300 + 4 optionals at minimal ~1 each → ~304
    // budget 150 → way too small even after all downgraded to minimal
    await expect(builder.build('game-1', 150)).rejects.toThrow(
      ContextBudgetExceededError,
    );
  });
});
