import { randomUUID } from 'node:crypto';

export function v4(): string {
  return randomUUID();
}

// Alias for clarity
export const uuidv4 = v4;
