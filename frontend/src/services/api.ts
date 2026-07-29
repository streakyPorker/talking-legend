import type {
  APIResponse,
  CreateGameResponse,
  GameActionResponse,
} from '@talking-legend/shared';

const API_BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  const body: APIResponse<T> = await response.json();

  if (!body.success || !body.data) {
    throw new Error(body.error ?? 'Unknown error');
  }

  return body.data;
}

export async function createGame(playerName: string): Promise<CreateGameResponse> {
  return request<CreateGameResponse>('/game', {
    method: 'POST',
    body: JSON.stringify({ playerName }),
  });
}

export async function performAction(
  gameId: string,
  action: string,
  target?: string,
): Promise<GameActionResponse> {
  return request<GameActionResponse>(`/game/${encodeURIComponent(gameId)}/action`, {
    method: 'POST',
    body: JSON.stringify({ gameId, action, target }),
  });
}

/** SSE 流式 GM 叙事 — 返回 ReadableStreamDefaultReader */
export async function performActionStream(
  gameId: string,
  action: string,
  target?: string,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(`${API_BASE}/game/${encodeURIComponent(gameId)}/action/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, target }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Stream request failed: ${response.status}`);
  }
  return response.body.getReader();
}

// === Config Center Types & API ===

export interface ConfigItem {
  key: string;
  label: string;
  value: string | number;
  type: 'text' | 'number';
  hotReload: boolean;
  readonly?: boolean;
  min?: number;
  max?: number;
}

export interface ConfigSection {
  key: string;
  label: string;
  restartRequired: boolean;
  items: ConfigItem[];
}

export interface GetConfigResponse {
  sections: ConfigSection[];
}

export interface UpdateConfigRequest {
  changes: Record<string, string | number>;
}

export interface UpdateConfigResponse {
  applied: string[];
  restartRequired: string[];
  errors: string[];
}

/** 读取全部配置 */
export async function getConfig(): Promise<GetConfigResponse> {
  return request<GetConfigResponse>('/config');
}

/** 更新部分配置项 */
export async function updateConfig(
  changes: Record<string, string | number>,
): Promise<UpdateConfigResponse> {
  return request<UpdateConfigResponse>('/config', {
    method: 'PUT',
    body: JSON.stringify({ changes } satisfies UpdateConfigRequest),
  });
}
