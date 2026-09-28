import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer triageiq/.env, then server/.env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable: ${name}. Copy triageiq/.env.example to triageiq/.env and configure it.`
    );
  }
  return value;
}

const corsRaw = process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173';

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
};

export function assertOpenAiConfigured(): void {
  if (!env.OPENAI_API_KEY) {
    const err = new Error(
      'OPENAI_API_KEY is not configured. Set it in triageiq/.env. TriageIQ does not use a mock LLM fallback.'
    );
    (err as Error & { statusCode?: number; code?: string }).statusCode = 503;
    (err as Error & { statusCode?: number; code?: string }).code = 'OPENAI_NOT_CONFIGURED';
    throw err;
  }
}
