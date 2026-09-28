import cors from 'cors';
import express from 'express';
import { ZodError } from 'zod';
import { env } from './config.js';
import { pool } from './db/pool.js';
import { errorHandler } from './middleware/errorHandler.js';
import { queueRouter } from './routes/queue.js';
import { sessionsRouter } from './routes/sessions.js';

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        // Same-origin / curl / server-to-server
        callback(null, true);
        return;
      }
      if (env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', async (_req, res) => {
  let dbOk = false;
  try {
    await pool.query('SELECT 1');
    dbOk = true;
  } catch {
    dbOk = false;
  }
  res.json({
    ok: true,
    service: 'triageiq-server',
    db: dbOk ? 'up' : 'down',
    openaiConfigured: Boolean(env.OPENAI_API_KEY),
    openaiNote: env.OPENAI_API_KEY
      ? 'OPENAI_API_KEY present — triage calls real OpenAI (no mock fallback)'
      : 'OPENAI_API_KEY missing — /api/sessions/:id/triage will return 503 OPENAI_NOT_CONFIGURED',
  });
});

app.use('/api/sessions', sessionsRouter);
app.use('/api/queue', queueRouter);

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      issues: err.issues,
    });
    return;
  }
  if (err instanceof Error && err.message.startsWith('CORS blocked')) {
    res.status(403).json({ error: err.message, code: 'CORS_DENIED' });
    return;
  }
  errorHandler(err, req, res, next);
});

app.listen(env.PORT, () => {
  console.log(`[triageiq] server listening on http://localhost:${env.PORT}`);
  console.log(`[triageiq] CORS origins: ${env.CORS_ORIGINS.join(', ')}`);
  console.log(
    `[triageiq] OpenAI: ${env.OPENAI_API_KEY ? 'configured' : 'NOT configured (triage will fail clearly)'}`
  );
});
