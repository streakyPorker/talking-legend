// RFC-004: Context 模块统一导出

export type {
  CallType,
  GatherContext,
  ModuleData,
  Granularity,
  ContextModule,
  AssembledContext,
  ModuleEntry,
  ModuleConfig,
} from './context-module.interface';

export { DEFAULT_MODULE_CONFIG } from './module-config';
export { ContextBudgetExceededError } from './context-budget.error';
export { NarrativeHistoryManager } from './narrative-history';
export type { NarrativeEntry, NarrativeHistory } from './narrative-history';
export { MemoryFilter } from './memory-filter';
export type { ClassifiedMemory, FilteredMemories, MemoryClassification } from './memory-filter';
export { BaseContextBuilder, GMContextBuilder, NpcContextBuilder, IntentContextBuilder, EventContextBuilder } from './context-builder';

// Modules
export { BaseContextModule } from './modules/base.module';
export { WorldStateModule } from './modules/world-state.module';
export { NpcPersonaModule } from './modules/npc-persona.module';
export { NpcMemoryModule } from './modules/npc-memory.module';
export { PlayerStateModule } from './modules/player-state.module';
export { NarrativeHistoryModule } from './modules/narrative-history.module';
export { ActiveEventsModule } from './modules/active-events.module';
export { ScenarioHintModule } from './modules/scenario-hint.module';
export { IntentInputModule } from './modules/intent-input.module';
