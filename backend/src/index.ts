import express from 'express';
import cors from 'cors';
import { gameRouter } from './routes/game.js';
import type { APIResponse } from '@talking-legend/shared';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  const response: APIResponse<{ status: string }> = {
    success: true,
    data: { status: 'ok' },
  };
  res.json(response);
});

// Routes
app.use('/api/game', gameRouter);

// Start server (only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`🎮 Talking Legend backend running on http://localhost:${PORT}`);
  });
}

export { app };
