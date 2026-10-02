import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer repo-root .env, then server/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable: ${name}. Copy .env.example to .env and configure it.`
    );
  }
  return value;
}

const corsRaw = process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173';

export type TriageMode = 'demo' | 'openai';

const triageModeRaw = (process.env.TRIAGE_MODE ?? 'demo').trim().toLowerCase();
const TRIAGE_MODE: TriageMode = triageModeRaw === 'openai' ? 'openai' : 'demo';

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL: requireEnv(
    'DATABASE_URL',
    'postgresql://triageiq:triageiq@localhost:5432/triageiq'
  ),
  CORS_ORIGINS: corsRaw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY?.trim() || '',
  OPENAI_MODEL: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
  /** Explicit switch: `demo` (local rules) or `openai` (real API; fails clearly if unpaid/missing). */
  TRIAGE_MODE,
};

export function assertOpenAiConfigured(): void {
  if (!env.OPENAI_API_KEY) {
    const err = new Error(
      'OPENAI_API_KEY is not configured. Set it in .env when TRIAGE_MODE=openai. TriageIQ does not silently mock LLM calls.'
    );
    (err as Error & { statusCode?: number; code?: string }).statusCode = 503;
    (err as Error & { statusCode?: number; code?: string }).code = 'OPENAI_NOT_CONFIGURED';
    throw err;
  }
}
