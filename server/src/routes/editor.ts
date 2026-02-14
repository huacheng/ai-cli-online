import { Router } from 'express';
import { writeFile } from 'fs/promises';
import { join, basename } from 'path';
import { resolveSession } from '../middleware/auth.js';
import { getCwd } from '../tmux.js';
import { getDraft, saveDraft as saveDraftDb, getAnnotation, saveAnnotation } from '../db.js';
import { validateNewPath } from '../files.js';

const router = Router();

// Get draft for a session
router.get('/api/sessions/:sessionId/draft', (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  const content = getDraft(sessionName);
  res.json({ content });
});

// Save (upsert) draft for a session
router.put('/api/sessions/:sessionId/draft', (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  const { content } = req.body as { content?: string };
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }
  saveDraftDb(sessionName, content);
  res.json({ ok: true });
});

// Get annotation for a file
router.get('/api/sessions/:sessionId/annotations', (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'path query parameter required' });
    return;
  }
  const result = getAnnotation(sessionName, filePath);
  res.json(result || { content: null, updatedAt: 0 });
});

// Save (upsert) annotation for a file
router.put('/api/sessions/:sessionId/annotations', (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  const { path: filePath, content, updatedAt } = req.body as { path?: string; content?: string; updatedAt?: number };
  if (!filePath || typeof filePath !== 'string') {
    res.status(400).json({ error: 'path must be a string' });
    return;
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content must be a string' });
    return;
  }
  saveAnnotation(sessionName, filePath, content, updatedAt || Date.now());
  res.json({ ok: true });
});

// Write .tmp-annotations.json for ai-cli-task plan
router.post('/api/sessions/:sessionId/task-annotations', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const { modulePath, content } = req.body as { modulePath?: string; content?: unknown };
    if (!modulePath || typeof modulePath !== 'string') {
      res.status(400).json({ error: 'modulePath must be a string' });
      return;
    }
    if (!content || typeof content !== 'object') {
      res.status(400).json({ error: 'content must be an object' });
      return;
    }
    const cwd = await getCwd(sessionName);
    const targetFile = join(modulePath, '.tmp-annotations.json');
    const resolved = await validateNewPath(targetFile, cwd);
    if (!resolved) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    if (basename(resolved) !== '.tmp-annotations.json') {
      res.status(400).json({ error: 'Only .tmp-annotations.json is allowed' });
      return;
    }
    await writeFile(resolved, JSON.stringify(content, null, 2), 'utf-8');
    res.json({ ok: true, path: resolved });
  } catch (err) {
    console.error(`[api:task-annotations] ${sessionName}:`, err);
    res.status(500).json({ error: 'Failed to write annotation file' });
  }
});

export default router;
