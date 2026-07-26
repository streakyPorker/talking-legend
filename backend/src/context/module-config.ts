/**
 * RFC-004: 默认模块配置（硬编码）。
 *
 * 定义四种调用类型各自使用的模块组合。后续可由前端配置页面覆盖
 * （新 RFC），当前为出厂默认值。
 */

import type { CallType, ModuleConfig } from './context-module.interface';

export const DEFAULT_MODULE_CONFIG: Record<CallType, ModuleConfig> = {
  gm_narrative: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'player_state', mandatory: false },
      { name: 'narrative_history', mandatory: false },
      { name: 'active_events', mandatory: false },
      { name: 'scenario_hint', mandatory: false },
    ],
  },
  npc_dialogue: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'npc_persona', mandatory: true },
      { name: 'npc_memory', mandatory: false },
      { name: 'player_state', mandatory: false },
      { name: 'narrative_history', mandatory: false },
      { name: 'active_events', mandatory: false },
    ],
  },
  intent_classify: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'intent_input', mandatory: true },
    ],
  },
  event_trigger: {
    modules: [
      { name: 'world_state', mandatory: true },
      { name: 'active_events', mandatory: false },
    ],
  },
};
