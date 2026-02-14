import express, { Router } from 'express';
import { writeFile, stat } from 'fs/promises';
import { join, basename, isAbsolute, resolve } from 'path';
import { resolveSession } from '../middleware/auth.js';
import { getDraft, saveDraft as saveDraftDb, getAnnotation, saveAnnotation } from '../db.js';

const MAX_FILE_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB (aligned with GET file-content in files.ts)

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
// modulePath is an absolute path from the frontend file browser (e.g. /home/user/project/AiTasks/task-name)
// Does NOT depend on tmux session — works even if the terminal session is disconnected
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
    // Validate: must be absolute, must be under an AiTasks/ directory
    if (!isAbsolute(modulePath)) {
      res.status(400).json({ error: 'modulePath must be absolute' });
      return;
    }
    const parts = modulePath.split('/');
    if (!parts.includes('AiTasks')) {
      res.status(400).json({ error: 'modulePath must be under AiTasks/' });
      return;
    }
    // Resolve to prevent path traversal (.. etc)
    const targetFile = resolve(join(modulePath, '.tmp-annotations.json'));
    if (basename(targetFile) !== '.tmp-annotations.json' || !targetFile.includes('/AiTasks/')) {
      res.status(400).json({ error: 'Invalid target path' });
      return;
    }
    // Verify parent directory exists
    try {
      await stat(modulePath);
    } catch {
      res.status(400).json({ error: `Directory not found: ${modulePath}` });
      return;
    }
    await writeFile(targetFile, JSON.stringify(content, null, 2), 'utf-8');
    res.json({ ok: true, path: targetFile });
  } catch (err) {
    console.error(`[api:task-annotations] ${sessionName}:`, err);
    res.status(500).json({ error: 'Failed to write annotation file' });
  }
});

// Write file content (for Plan panel inline editing)
// Only allows writing to files under AiTasks/ directories
router.put('/api/sessions/:sessionId/file-content', express.json({ limit: '11mb' }), async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const { path: filePath, content } = req.body as { path?: string; content?: string };
    if (!filePath || typeof filePath !== 'string') {
      res.status(400).json({ error: 'path must be a string' });
      return;
    }
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' });
      return;
    }
    if (content.length > MAX_FILE_CONTENT_SIZE) {
      res.status(413).json({ error: 'Content too large (max 2MB)' });
      return;
    }
    // Must be absolute path
    if (!isAbsolute(filePath)) {
      res.status(400).json({ error: 'path must be absolute' });
      return;
    }
    // Must be under an AiTasks/ directory
    const parts = filePath.split('/');
    if (!parts.includes('AiTasks')) {
      res.status(400).json({ error: 'path must be under AiTasks/' });
      return;
    }
    // Resolve to prevent path traversal
    const resolved = resolve(filePath);
    if (!resolved.includes('/AiTasks/')) {
      res.status(400).json({ error: 'Invalid target path' });
      return;
    }
    // Verify the file exists (don't create new files through this endpoint)
    try {
      const fileStat = await stat(resolved);
      if (!fileStat.isFile()) {
        res.status(400).json({ error: 'Not a file' });
        return;
      }
    } catch {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    await writeFile(resolved, content, 'utf-8');
    const newStat = await stat(resolved);
    res.json({ ok: true, mtime: newStat.mtimeMs });
  } catch (err) {
    console.error(`[api:file-content:write] ${sessionName}:`, err);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

export default router;
