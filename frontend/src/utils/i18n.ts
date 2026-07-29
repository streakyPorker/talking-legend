/** 区域名中文映射 */
export const REGION_CN: Record<string, string> = {
  village: '石辉村',
  forest: '低语森林',
  lake: '镜湖',
  mountains: '龙脊峰',
};
export function regionCN(id: string): string {
  return REGION_CN[id] ?? id;
}

/** 天气中文 */
export const WEATHER_CN: Record<string, string> = {
  clear: '晴朗',
  cloudy: '多云',
  rain: '雨',
  storm: '暴风雨',
  fog: '雾',
  snow: '雪',
};
export function weatherCN(w: string): string {
  return WEATHER_CN[w] ?? w;
}

/** 时间中文 */
export const TIME_CN: Record<string, string> = {
  morning: '清晨',
  afternoon: '午后',
  evening: '黄昏',
  night: '深夜',
};
export function timeCN(t: string): string {
  return TIME_CN[t] ?? t;
}

/** 任务状态中文 */
export function questStatusCN(status: string): string {
  const map: Record<string, string> = {
    active: '进行中',
    completed: '已完成',
    failed: '失败',
  };
  return map[status] ?? status;
}
