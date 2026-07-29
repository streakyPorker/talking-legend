import { RegionInfo } from './RegionInfo.js';
import { ConnectedRegions } from './ConnectedRegions.js';
import { QuestList } from './QuestList.js';
import { NearbyNpcs } from './NearbyNpcs.js';

/** Q8: 子组件（RegionInfo/ConnectedRegions/QuestList/NearbyNpcs）独立可复用，
 *  不依赖本容器。RFC-015 可直接拿用放入 TopNavBar popover。 */
export function RegionSidebar() {
  return (
    <aside className="w-[260px] border-l border-base-300 pl-4 overflow-y-auto flex flex-col gap-4">
      <RegionInfo />
      <ConnectedRegions />
      <QuestList />
      <NearbyNpcs />
    </aside>
  );
}
