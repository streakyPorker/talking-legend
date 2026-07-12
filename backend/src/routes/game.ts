import { Router } from 'express';
import type {
  APIResponse,
  CreateGameRequest,
  CreateGameResponse,
  GameActionRequest,
  GameActionResponse,
} from '@talking-legend/shared';
import { createGame, performAction } from '../services/game-service.js';

export const gameRouter = Router();

// POST /api/game - Create a new game
gameRouter.post('/', async (req, res) => {
  try {
    const body = req.body as CreateGameRequest;
    if (!body.playerName) {
      const response: APIResponse<never> = {
        success: false,
        error: 'playerName is required',
      };
      res.status(400).json(response);
      return;
    }

    const result = await createGame(body);
    const response: APIResponse<CreateGameResponse> = {
      success: true,
      data: result,
    };
    res.status(201).json(response);
  } catch (err) {
    const response: APIResponse<never> = {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create game',
    };
    res.status(500).json(response);
  }
});

// POST /api/game/:id/action - Perform an action in a game
gameRouter.post('/:id/action', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as GameActionRequest;

    if (!body.action) {
      const response: APIResponse<never> = {
        success: false,
        error: 'action is required',
      };
      res.status(400).json(response);
      return;
    }

    const result = await performAction(id, body);
    const response: APIResponse<GameActionResponse> = {
      success: true,
      data: result,
    };
    res.json(response);
  } catch (err) {
    const response: APIResponse<never> = {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to perform action',
    };
    res.status(500).json(response);
  }
});
