import { useResizable } from '../../hooks/useResizable.js';
import { RegionInfo } from './RegionInfo.js';
import { ConnectedRegions } from './ConnectedRegions.js';
import { QuestList } from './QuestList.js';
import { NearbyNpcs } from './NearbyNpcs.js';

interface RegionSidebarProps {
  onNpcClick?: (npc: { id: string; name: string; role: string; personality: string; currentMood: string }) => void;
}

export function RegionSidebar({ onNpcClick }: RegionSidebarProps) {
  const { width, dragging, onMouseDown } = useResizable({
    initial: 260,
    min: 180,
    max: 500,
  });

  return (
    <aside
      className="border-l border-base-300 pl-4 flex flex-col gap-4 shrink-0 relative"
      style={{ width }}
    >
      {/* 拖拽手柄 */}
      <div
        onMouseDown={onMouseDown}
        className={`absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors ${
          dragging ? 'bg-primary/50' : ''
        }`}
        title="拖动调整宽度"
      />

      <RegionInfo />
      <ConnectedRegions />
      <QuestList />
      <NearbyNpcs onNpcClick={onNpcClick} />

      {/* 宽度指示器 */}
      <span className="text-[10px] text-base-content/30 text-right">{width}px</span>
    </aside>
  );
}
