import type { NextFunction, Request, Response } from 'express';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const e = err as Error & { statusCode?: number; code?: string; issues?: unknown };
  const status = e.statusCode ?? 500;
  const code = e.code ?? (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');

  if (status >= 500) {
    console.error('[error]', code, e.message, e.stack);
  } else {
    console.warn('[warn]', code, e.message);
  }

  res.status(status).json({
    error: e.message || 'Unexpected server error',
    code,
    issues: e.issues,
  });
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
