import type { Request, Response } from 'express';
import { createHash } from 'crypto';
import { safeTokenCompare } from '../auth.js';
import { buildSessionName, isValidSessionId } from '../tmux.js';

/** Extract Bearer token from Authorization header */
export function extractToken(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return undefined;
}

/** Check auth — reads AUTH_TOKEN lazily from env (dotenv loads before route handlers run) */
export function checkAuth(req: Request, res: Response): boolean {
  const authToken = process.env.AUTH_TOKEN || '';
  if (!authToken) return true;
  const token = extractToken(req);
  if (!token || !safeTokenCompare(token, authToken)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/** Resolve session: auth check + sessionId validation + build tmux session name */
export function resolveSession(req: Request, res: Response): string | null {
  if (!checkAuth(req, res)) return null;
  const sessionId = req.params.sessionId as string;
  if (!isValidSessionId(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId' });
    return null;
  }
  const token = extractToken(req) || 'default';
  return buildSessionName(token, sessionId);
}

/** Hash token for settings storage (same prefix as tmux session names) */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}
