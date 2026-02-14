import { Router } from 'express';
import { checkAuth, extractToken, tokenHash } from '../middleware/auth.js';
import { getSetting, saveSetting } from '../db.js';
import { safeTokenCompare } from '../auth.js';

const router = Router();

// Get font size
router.get('/api/settings/font-size', (req, res) => {
  if (!checkAuth(req, res)) return;
  const token = extractToken(req) || 'default';
  const value = getSetting(tokenHash(token), 'font-size');
  const fontSize = value !== null ? parseInt(value, 10) : 14;
  res.json({ fontSize: isNaN(fontSize) ? 14 : fontSize });
});

// Save font size
router.put('/api/settings/font-size', (req, res) => {
  if (!checkAuth(req, res)) return;
  const token = extractToken(req) || 'default';
  const { fontSize } = req.body as { fontSize?: number };
  if (typeof fontSize !== 'number' || fontSize < 10 || fontSize > 24) {
    res.status(400).json({ error: 'fontSize must be a number between 10 and 24' });
    return;
  }
  saveSetting(tokenHash(token), 'font-size', String(fontSize));
  res.json({ ok: true });
});

// Get tabs layout
router.get('/api/settings/tabs-layout', (req, res) => {
  if (!checkAuth(req, res)) return;
  const token = extractToken(req) || 'default';
  const value = getSetting(tokenHash(token), 'tabs-layout');
  let layout = null;
  if (value) {
    try { layout = JSON.parse(value); } catch { /* corrupt data */ }
  }
  res.json({ layout });
});

// Save tabs layout (supports both Authorization header and body token for sendBeacon)
router.put('/api/settings/tabs-layout', (req, res) => {
  const { layout, token: bodyToken } = req.body as { layout?: unknown; token?: string };
  const authToken = process.env.AUTH_TOKEN || '';

  let token: string | undefined;
  if (authToken) {
    token = extractToken(req);
    if (!token && bodyToken) {
      if (!safeTokenCompare(bodyToken, authToken)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      token = bodyToken;
    }
    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  } else {
    token = extractToken(req) || bodyToken || 'default';
  }

  if (!layout || typeof layout !== 'object') {
    res.status(400).json({ error: 'layout must be an object' });
    return;
  }
  saveSetting(tokenHash(token), 'tabs-layout', JSON.stringify(layout));
  res.json({ ok: true });
});

export default router;
