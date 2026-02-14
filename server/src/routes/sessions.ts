import { Router } from 'express';
import { extractToken, checkAuth, resolveSession } from '../middleware/auth.js';
import { listSessions, killSession, buildSessionName, getCwd, getPaneCommand } from '../tmux.js';
import { getActiveSessionNames } from '../websocket.js';
import { deleteDraft } from '../db.js';

const router = Router();

// List sessions for a token
router.get('/api/sessions', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const token = extractToken(req) || 'default';
  const sessions = await listSessions(token);
  const activeNames = getActiveSessionNames();
  const result = sessions.map((s) => ({
    sessionId: s.sessionId,
    sessionName: s.sessionName,
    createdAt: s.createdAt,
    active: activeNames.has(s.sessionName),
  }));
  res.json(result);
});

// Kill a specific session
router.delete('/api/sessions/:sessionId', async (req, res) => {
  if (!checkAuth(req, res)) return;
  const { sessionId } = req.params;
  if (!/^[\w-]+$/.test(sessionId)) {
    res.status(400).json({ error: 'Invalid sessionId' });
    return;
  }
  const token = extractToken(req) || 'default';
  const sessionName = buildSessionName(token, sessionId);
  await killSession(sessionName);
  deleteDraft(sessionName);
  res.json({ ok: true });
});

// Get current working directory
router.get('/api/sessions/:sessionId/cwd', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const cwd = await getCwd(sessionName);
    res.json({ cwd });
  } catch (err) {
    console.error(`[api:cwd] ${sessionName}:`, err);
    res.status(404).json({ error: 'Session not found or not running' });
  }
});

// Get current pane command (to detect if claude is running)
router.get('/api/sessions/:sessionId/pane-command', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const command = await getPaneCommand(sessionName);
    res.json({ command });
  } catch {
    res.json({ command: '' });
  }
});

export default router;
