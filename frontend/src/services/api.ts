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
