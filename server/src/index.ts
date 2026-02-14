import express from 'express';
import compression from 'compression';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { config } from 'dotenv';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { spawn } from 'child_process';
import { copyFile, unlink, stat, mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { setupWebSocket, getActiveSessionNames, clearWsIntervals } from './websocket.js';
import { isTmuxAvailable, listSessions, buildSessionName, killSession, isValidSessionId, cleanupStaleSessions, getCwd, getPaneCommand } from './tmux.js';
import { listFiles, validatePath, validatePathNoSymlink, validateNewPath, MAX_DOWNLOAD_SIZE, MAX_UPLOAD_SIZE } from './files.js';
import { getDraft, saveDraft as saveDraftDb, deleteDraft, cleanupOldDrafts, getSetting, saveSetting, getAnnotation, saveAnnotation, cleanupOldAnnotations, closeDb } from './db.js';
import { safeTokenCompare } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

config();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const DEFAULT_WORKING_DIR = process.env.DEFAULT_WORKING_DIR || process.env.HOME || '/home/ubuntu';
const HTTPS_ENABLED = process.env.HTTPS_ENABLED !== 'false';
const CORS_ORIGIN = process.env.CORS_ORIGIN || ''; // empty = no CORS headers (same-origin only)
const TRUST_PROXY = process.env.TRUST_PROXY || ''; // set to '1' when behind a reverse proxy
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || '10', 10);
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '24', 10);
const RATE_LIMIT_READ = parseInt(process.env.RATE_LIMIT_READ || '180', 10);
const RATE_LIMIT_WRITE = parseInt(process.env.RATE_LIMIT_WRITE || '60', 10);

const CERT_PATH = join(__dirname, '../certs/server.crt');
const KEY_PATH = join(__dirname, '../certs/server.key');

// Catch unhandled promise rejections to prevent silent crashes
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
});

async function main() {
  // Check tmux availability
  if (!isTmuxAvailable()) {
    console.error('ERROR: tmux is not available. Please install it first.');
    console.error('Run: sudo apt install tmux');
    process.exit(1);
  }
  console.log('tmux is available');

  const app = express();
  // Only trust proxy headers when explicitly configured (prevents IP spoofing without proxy)
  if (TRUST_PROXY) {
    app.set('trust proxy', parseInt(TRUST_PROXY, 10) || TRUST_PROXY);
  }

  // Compress HTTP responses (WebSocket has its own perMessageDeflate)
  app.use(compression());

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "https:", "data:", "blob:"],
        connectSrc: ["'self'", "wss:", "ws:"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    frameguard: { action: 'deny' },
  }));

  // Rate limiting — higher limit for read-only GET, lower for mutations
  app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    max: (req) => req.method === 'GET' ? RATE_LIMIT_READ : RATE_LIMIT_WRITE,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests' },
  }));

  // JSON body parser for draft API
  app.use(express.json({ limit: '256kb' }));

  // CORS (only add headers when CORS_ORIGIN is explicitly configured)
  if (CORS_ORIGIN) {
    app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      if (_req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
  }

  // Auth check helper — reads Authorization header only (no query param to avoid token in logs)
  function extractToken(req: express.Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return undefined;
  }

  function checkAuth(req: express.Request, res: express.Response): boolean {
    if (!AUTH_TOKEN) return true;
    const token = extractToken(req);
    if (!token || !safeTokenCompare(token, AUTH_TOKEN)) {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    }
    return true;
  }

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // List sessions for a token
  app.get('/api/sessions', async (req, res) => {
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
  app.delete('/api/sessions/:sessionId', async (req, res) => {
    if (!checkAuth(req, res)) return;
    if (!isValidSessionId(req.params.sessionId)) {
      res.status(400).json({ error: 'Invalid sessionId' });
      return;
    }
    const token = extractToken(req) || 'default';
    const sessionName = buildSessionName(token, req.params.sessionId);
    await killSession(sessionName);
    deleteDraft(sessionName);
    res.json({ ok: true });
  });

  // --- File transfer APIs ---

  const UPLOAD_TMP_DIR = '/tmp/ai-cli-online-uploads';
  await mkdir(UPLOAD_TMP_DIR, { recursive: true, mode: 0o700 });

  const upload = multer({
    dest: UPLOAD_TMP_DIR,
    limits: { fileSize: MAX_UPLOAD_SIZE, files: 10 },
  });

  /** Helper: resolve session from request params + auth */
  function resolveSession(req: express.Request, res: express.Response): string | null {
    if (!checkAuth(req, res)) return null;
    const sessionId = req.params.sessionId as string;
    if (!isValidSessionId(sessionId)) {
      res.status(400).json({ error: 'Invalid sessionId' });
      return null;
    }
    const token = extractToken(req) || 'default';
    return buildSessionName(token, sessionId);
  }

  // Get current working directory
  app.get('/api/sessions/:sessionId/cwd', async (req, res) => {
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

  // List files in directory
  app.get('/api/sessions/:sessionId/files', async (req, res) => {
    const sessionName = resolveSession(req, res);
    if (!sessionName) return;
    try {
      const cwd = await getCwd(sessionName);
      const subPath = (req.query.path as string) || '';
      let targetDir: string | null = null;
      if (subPath) {
        targetDir = await validatePath(subPath, cwd);
        // Fallback: allow absolute paths under HOME (e.g., ~/.claude/commands)
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
  app.post('/api/sessions/:sessionId/upload', upload.array('files', 10), async (req, res) => {
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
        // Sanitize filename: strip path components to prevent directory traversal
        const safeName = basename(file.originalname);
        if (!safeName || safeName === '.' || safeName === '..') {
          await unlink(file.path).catch(() => {});
          continue;
        }
        const destPath = join(cwd, safeName);
        // Use copyFile + unlink instead of rename to handle cross-device moves
        await copyFile(file.path, destPath);
        await unlink(file.path).catch(() => {});
        results.push({ name: safeName, size: file.size });
      }
      res.json({ uploaded: results });
    } catch (err) {
      console.error('[upload] Failed:', err);
      // Clean up multer temp files on error to prevent disk leak
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
  app.get('/api/sessions/:sessionId/download', async (req, res) => {
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
      // A3: Stream with byte counting to guard against TOCTOU size changes
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
  app.get('/api/sessions/:sessionId/download-cwd', async (req, res) => {
    const sessionName = resolveSession(req, res);
    if (!sessionName) return;
    try {
      const cwd = await getCwd(sessionName);
      // A5: Validate CWD format before passing to tar
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

  // --- Draft API ---

  // Get draft for a session
  app.get('/api/sessions/:sessionId/draft', (req, res) => {
    const sessionName = resolveSession(req, res);
    if (!sessionName) return;
    const content = getDraft(sessionName);
    res.json({ content });
  });

  // Save (upsert) draft for a session
  app.put('/api/sessions/:sessionId/draft', (req, res) => {
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

  // --- Annotations API ---

  // Get annotation for a file
  app.get('/api/sessions/:sessionId/annotations', (req, res) => {
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
  app.put('/api/sessions/:sessionId/annotations', (req, res) => {
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

  // --- Task annotations API (write .tmp-annotations.json for ai-cli-task plan) ---

  app.post('/api/sessions/:sessionId/task-annotations', async (req, res) => {
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
      // Only allow writing .tmp-annotations.json filename
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

  // --- Pane command API ---

  // Get current pane command (to detect if claude is running)
  app.get('/api/sessions/:sessionId/pane-command', async (req, res) => {
    const sessionName = resolveSession(req, res);
    if (!sessionName) return;
    try {
      const command = await getPaneCommand(sessionName);
      res.json({ command });
    } catch {
      res.json({ command: '' });
    }
  });

  // --- Touch (create empty file) API ---

  app.post('/api/sessions/:sessionId/touch', async (req, res) => {
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
      // Ensure parent directory exists (supports paths like "PLAN/INDEX.md")
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, '', { flag: 'wx' }); // create exclusively
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

  // --- Mkdir (create directory) API ---

  app.post('/api/sessions/:sessionId/mkdir', async (req, res) => {
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

  // --- Delete file/directory API ---

  app.delete('/api/sessions/:sessionId/rm', async (req, res) => {
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

  // --- Settings API ---

  /** Hash token for settings storage (same prefix as tmux session names) */
  function tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 8);
  }

  app.get('/api/settings/font-size', (req, res) => {
    if (!checkAuth(req, res)) return;
    const token = extractToken(req) || 'default';
    const value = getSetting(tokenHash(token), 'font-size');
    const fontSize = value !== null ? parseInt(value, 10) : 14;
    res.json({ fontSize: isNaN(fontSize) ? 14 : fontSize });
  });

  app.put('/api/settings/font-size', (req, res) => {
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

  // --- Tabs layout persistence API ---

  app.get('/api/settings/tabs-layout', (req, res) => {
    if (!checkAuth(req, res)) return;
    const token = extractToken(req) || 'default';
    const value = getSetting(tokenHash(token), 'tabs-layout');
    let layout = null;
    if (value) {
      try { layout = JSON.parse(value); } catch { /* corrupt data */ }
    }
    res.json({ layout });
  });

  app.put('/api/settings/tabs-layout', (req, res) => {
    const { layout, token: bodyToken } = req.body as { layout?: unknown; token?: string };
    // Support both Authorization header and body token (for sendBeacon)
    let token: string | undefined;
    if (AUTH_TOKEN) {
      token = extractToken(req);
      if (!token && bodyToken) {
        // sendBeacon path: validate token from body
        if (!safeTokenCompare(bodyToken, AUTH_TOKEN)) {
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

  // --- Document browser: file content API ---

  const MAX_DOC_SIZE = 10 * 1024 * 1024; // 10MB
  const PDF_EXTENSIONS = new Set(['.pdf']);

  app.get('/api/sessions/:sessionId/file-content', async (req, res) => {
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
      // Fallback: allow absolute paths under HOME (e.g., ~/.claude/plugins/)
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
      // 304 check: if client sends `since` and file hasn't changed
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

  // Serve static files from web/dist in production
  const webDistPath = join(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    // Vite generates content-hashed filenames — safe to cache indefinitely
    app.use(express.static(webDistPath, {
      maxAge: '1y',
      immutable: true,
      index: false,
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      // index.html must not be cached (references hashed assets)
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDistPath, 'index.html'));
    });
    console.log('Serving static files from:', webDistPath);
  }

  // SSL setup
  const hasSSL = existsSync(CERT_PATH) && existsSync(KEY_PATH);
  const useHttps = HTTPS_ENABLED && hasSSL;

  let server: ReturnType<typeof createHttpServer>;
  if (useHttps) {
    server = createHttpsServer(
      { cert: readFileSync(CERT_PATH), key: readFileSync(KEY_PATH) },
      app,
    );
    console.log('HTTPS enabled with SSL certificates');
  } else {
    server = createHttpServer(app);
    if (HTTPS_ENABLED && !hasSSL) {
      console.log('WARNING: HTTPS enabled but certificates not found, falling back to HTTP');
    }
  }

  // WebSocket server with compression and increased payload limit
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 1024 * 1024, // 1MB (supports large paste operations)
    perMessageDeflate: {
      zlibDeflateOptions: { level: 1 }, // Fastest compression to avoid CPU bottleneck
      threshold: 128, // Only compress messages > 128 bytes
      concurrencyLimit: 10,
      clientNoContextTakeover: true, // Stateless compression — better proxy compatibility
      serverNoContextTakeover: true,
    },
  });
  setupWebSocket(wss, AUTH_TOKEN, DEFAULT_WORKING_DIR, safeTokenCompare, MAX_CONNECTIONS);

  const protocol = useHttps ? 'https' : 'http';
  const wsProtocol = useHttps ? 'wss' : 'ws';

  server.listen(Number(PORT), HOST, () => {
    console.log('');
    console.log('='.repeat(50));
    console.log('  AI-CLI-Online Terminal Server');
    console.log('='.repeat(50));
    console.log(`  ${protocol.toUpperCase()}:      ${protocol}://${HOST}:${PORT}`);
    console.log(`  WebSocket: ${wsProtocol}://${HOST}:${PORT}/ws`);
    console.log(`  CWD:       ${DEFAULT_WORKING_DIR}`);
    console.log(`  SSL:       ${useHttps ? 'Enabled' : 'Disabled'}`);
    console.log(`  Auth:      ${AUTH_TOKEN ? 'Token required' : 'No authentication'}`);
    console.log('='.repeat(50));
    console.log('');
  });

  // Run startup cleanup immediately (clear stale drafts from previous runs)
  try {
    const purged = cleanupOldDrafts(7);
    if (purged > 0) console.log(`[startup] Cleaned up ${purged} stale drafts`);
  } catch (e) { console.error('[startup:drafts]', e); }

  // Periodic cleanup of stale tmux sessions
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  if (SESSION_TTL_HOURS > 0) {
    const CLEANUP_INTERVAL = 60 * 60 * 1000; // every hour
    cleanupTimer = setInterval(() => {
      cleanupStaleSessions(SESSION_TTL_HOURS).catch((e) => console.error('[cleanup]', e));
      try { cleanupOldDrafts(7); } catch (e) { console.error('[cleanup:drafts]', e); }
      try { cleanupOldAnnotations(7); } catch (e) { console.error('[cleanup:annotations]', e); }
    }, CLEANUP_INTERVAL);
    console.log(`Session TTL: ${SESSION_TTL_HOURS}h (cleanup every hour)`);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[shutdown] Closing server...');
    // Clear all intervals to allow event loop to drain
    clearWsIntervals();
    if (cleanupTimer) clearInterval(cleanupTimer);
    // Close all WebSocket connections (triggers ws 'close' handlers which kill PTYs)
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    // Allow 500ms for WebSocket close handlers to fire and clean up PTYs
    setTimeout(() => {
      server.close(() => {
        try { closeDb(); } catch { /* ignore */ }
        console.log('[shutdown] Server closed');
        process.exit(0);
      });
    }, 500);
    // Force exit after 5s if graceful close hangs
    setTimeout(() => {
      console.log('[shutdown] Forced exit');
      process.exit(1);
    }, 5000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
