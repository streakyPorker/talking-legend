import { z } from 'zod';

export const CreateGameRequestSchema = z.object({
  playerName: z.string().min(1, 'playerName is required'),
  scenario: z.string().optional(),
});

export const GameActionRequestSchema = z.object({
  action: z.string().min(1, 'action is required'),
  target: z.string().optional(),
});

export type CreateGameRequestValidated = z.infer<typeof CreateGameRequestSchema>;
export type GameActionRequestValidated = z.infer<typeof GameActionRequestSchema>;
