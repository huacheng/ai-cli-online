import { Router } from 'express';
import multer from 'multer';
import { createReadStream, mkdirSync } from 'fs';
import { copyFile, unlink, stat, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { spawn } from 'child_process';
import { resolveSession } from '../middleware/auth.js';
import { getCwd } from '../tmux.js';
import { listFiles, validatePath, validatePathNoSymlink, validateNewPath, MAX_DOWNLOAD_SIZE, MAX_UPLOAD_SIZE } from '../files.js';

const router = Router();

// Multer setup for file uploads
const UPLOAD_TMP_DIR = '/tmp/ai-cli-online-uploads';
mkdirSync(UPLOAD_TMP_DIR, { recursive: true, mode: 0o700 });

const upload = multer({
  dest: UPLOAD_TMP_DIR,
  limits: { fileSize: MAX_UPLOAD_SIZE, files: 10 },
});

// List files in directory
router.get('/api/sessions/:sessionId/files', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const cwd = await getCwd(sessionName);
    const subPath = (req.query.path as string) || '';
    let targetDir: string | null = null;
    if (subPath) {
      targetDir = await validatePath(subPath, cwd);
      if (!targetDir) {
        const home = process.env.HOME || '/root';
        targetDir = await validatePath(subPath, home);
      }
    } else {
      targetDir = cwd;
    }
    if (!targetDir) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const { files, truncated } = await listFiles(targetDir);
    res.json({ cwd: targetDir, home: process.env.HOME || '/root', files, truncated });
  } catch (err) {
    console.error(`[api:files] ${sessionName}:`, err);
    res.status(404).json({ error: 'Session not found or directory not accessible' });
  }
});

// Upload files to CWD
router.post('/api/sessions/:sessionId/upload', upload.array('files', 10), async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const cwd = await getCwd(sessionName);
    const uploadedFiles = req.files as Express.Multer.File[];
    if (!uploadedFiles || uploadedFiles.length === 0) {
      res.status(400).json({ error: 'No files provided' });
      return;
    }
    const results: { name: string; size: number }[] = [];
    for (const file of uploadedFiles) {
      const safeName = basename(file.originalname);
      if (!safeName || safeName === '.' || safeName === '..') {
        await unlink(file.path).catch(() => {});
        continue;
      }
      const destPath = join(cwd, safeName);
      await copyFile(file.path, destPath);
      await unlink(file.path).catch(() => {});
      results.push({ name: safeName, size: file.size });
    }
    res.json({ uploaded: results });
  } catch (err) {
    console.error('[upload] Failed:', err);
    const files = req.files as Express.Multer.File[] | undefined;
    if (files) {
      for (const f of files) {
        await unlink(f.path).catch(() => {});
      }
    }
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Download a file
router.get('/api/sessions/:sessionId/download', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const cwd = await getCwd(sessionName);
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'path query parameter required' });
      return;
    }
    const resolved = await validatePathNoSymlink(filePath, cwd);
    if (!resolved) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      res.status(400).json({ error: 'Not a file' });
      return;
    }
    if (fileStat.size > MAX_DOWNLOAD_SIZE) {
      res.status(413).json({ error: 'File too large (max 100MB)' });
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(basename(resolved))}"`);
    res.setHeader('Content-Length', fileStat.size);
    const stream = createReadStream(resolved);
    let bytesWritten = 0;
    stream.on('data', (chunk) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      bytesWritten += buf.length;
      if (bytesWritten > MAX_DOWNLOAD_SIZE) {
        stream.destroy();
        if (!res.writableEnded) res.end();
        return;
      }
      if (!res.writableEnded) res.write(chunk);
    });
    stream.on('end', () => { if (!res.writableEnded) res.end(); });
    stream.on('error', () => { if (!res.writableEnded) res.end(); });
  } catch (err) {
    console.error(`[api:download] ${sessionName}:`, err);
    res.status(404).json({ error: 'File not found' });
  }
});

// Download CWD as tar.gz
router.get('/api/sessions/:sessionId/download-cwd', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const cwd = await getCwd(sessionName);
    if (!cwd.startsWith('/') || cwd.includes('\0')) {
      res.status(400).json({ error: 'Invalid working directory' });
      return;
    }
    const dirName = basename(cwd);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(dirName)}.tar.gz"`);
    const tar = spawn('tar', ['czf', '-', '-C', cwd, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
    tar.stdout.pipe(res);
    tar.stderr.on('data', (data: Buffer) => console.error(`[tar stderr] ${data}`));
    tar.on('error', (err) => {
      console.error('[api:download-cwd] tar error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to create archive' });
    });
    tar.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: 'Archive creation failed' });
      }
    });
  } catch (err) {
    console.error(`[api:download-cwd] ${sessionName}:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to download' });
  }
});

// Create empty file
router.post('/api/sessions/:sessionId/touch', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || name.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }
    const cwd = await getCwd(sessionName);
    const resolved = await validateNewPath(join(cwd, name), cwd);
    if (!resolved) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, '', { flag: 'wx' });
    res.json({ ok: true, path: resolved });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      const cwd = await getCwd(sessionName).catch(() => '');
      res.json({ ok: true, existed: true, path: cwd ? join(cwd, String((req.body as { name: string }).name)) : '' });
    } else {
      console.error(`[api:touch] ${sessionName}:`, err);
      res.status(500).json({ error: 'Failed to create file' });
    }
  }
});

// Create directory
router.post('/api/sessions/:sessionId/mkdir', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const { path: dirPath } = req.body as { path?: string };
    if (!dirPath || typeof dirPath !== 'string' || dirPath.includes('..')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const cwd = await getCwd(sessionName);
    const resolved = await validateNewPath(join(cwd, dirPath), cwd);
    if (!resolved) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    await mkdir(resolved, { recursive: true });
    res.json({ ok: true, path: resolved });
  } catch (err) {
    console.error(`[api:mkdir] ${sessionName}:`, err);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// Delete file or directory
router.delete('/api/sessions/:sessionId/rm', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  try {
    const { path: rmPath } = req.body as { path?: string };
    if (!rmPath || typeof rmPath !== 'string' || rmPath.includes('..')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const cwd = await getCwd(sessionName);
    const resolved = await validatePath(rmPath, cwd);
    if (!resolved) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const fileStat = await stat(resolved);
    if (fileStat.isDirectory()) {
      await rm(resolved, { recursive: true });
    } else {
      await unlink(resolved);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(`[api:rm] ${sessionName}:`, err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// Read file content (for document viewer)
const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB
const PDF_EXTENSIONS = new Set(['.pdf']);

router.get('/api/sessions/:sessionId/file-content', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: 'path query parameter required' });
    return;
  }
  try {
    const cwd = await getCwd(sessionName);
    let resolved = await validatePathNoSymlink(filePath, cwd);
    if (!resolved) {
      const home = process.env.HOME || '/root';
      resolved = await validatePathNoSymlink(filePath, home);
    }
    if (!resolved) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      res.status(400).json({ error: 'Not a file' });
      return;
    }
    if (fileStat.size > MAX_DOC_SIZE) {
      res.status(413).json({ error: 'File too large (max 10MB)' });
      return;
    }
    const since = parseFloat(req.query.since as string) || 0;
    if (since > 0 && fileStat.mtimeMs <= since) {
      res.status(304).end();
      return;
    }
    const ext = extname(resolved).toLowerCase();
    const isPdf = PDF_EXTENSIONS.has(ext);
    const content = await readFile(resolved, isPdf ? undefined : 'utf-8');
    res.json({
      content: isPdf ? (content as Buffer).toString('base64') : content,
      mtime: fileStat.mtimeMs,
      size: fileStat.size,
      encoding: isPdf ? 'base64' : 'utf-8',
    });
  } catch (err) {
    console.error(`[api:file-content] ${sessionName}:`, err);
    res.status(404).json({ error: 'File not found' });
  }
});

export default router;
