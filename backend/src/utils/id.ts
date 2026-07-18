import { randomUUID } from 'crypto';

export function uuid(): string { return randomUUID(); }
export const v4 = uuid;
export const uuidv4 = uuid;
