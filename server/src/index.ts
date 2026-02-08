import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { config } from 'dotenv';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { copyFile, unlink, stat, mkdir, readFile } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket, getActiveSessionNames } from './websocket.js';
import { isTmuxAvailable, listSessions, buildSessionName, killSession, isValidSessionId, cleanupStaleSessions, getCwd, getPaneCommand } from './tmux.js';
import { listFiles, validatePath, MAX_DOWNLOAD_SIZE, MAX_UPLOAD_SIZE } from './files.js';
import { getDraft, saveDraft as saveDraftDb, deleteDraft, cleanupOldDrafts, closeDb } from './db.js';
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

const CERT_PATH = join(__dirname, '../certs/server.crt');
const KEY_PATH = join(__dirname, '../certs/server.key');

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

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "wss:", "ws:"],
      },
    },
    frameguard: { action: 'deny' },
  }));

  // Rate limiting on API endpoints
  app.use('/api/', rateLimit({
    windowMs: 60 * 1000,
    max: 60,
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
    const { sessionId } = req.params;
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
    } catch {
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
      const targetDir = subPath ? await validatePath(subPath, cwd) : cwd;
      if (!targetDir) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const files = await listFiles(targetDir);
      res.json({ cwd: targetDir, files });
    } catch {
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
      const resolved = await validatePath(filePath, cwd);
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
      createReadStream(resolved).pipe(res);
    } catch {
      res.status(404).json({ error: 'File not found' });
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
      const resolved = await validatePath(filePath, cwd);
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
    } catch {
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

  // Periodic cleanup of stale tmux sessions
  if (SESSION_TTL_HOURS > 0) {
    const CLEANUP_INTERVAL = 60 * 60 * 1000; // every hour
    setInterval(() => {
      cleanupStaleSessions(SESSION_TTL_HOURS).catch((e) => console.error('[cleanup]', e));
      try { cleanupOldDrafts(7); } catch (e) { console.error('[cleanup:drafts]', e); }
    }, CLEANUP_INTERVAL);
    console.log(`Session TTL: ${SESSION_TTL_HOURS}h (cleanup every hour)`);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[shutdown] Closing server...');
    // Close all WebSocket connections
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    server.close(() => {
      try { closeDb(); } catch { /* ignore */ }
      console.log('[shutdown] Server closed');
      process.exit(0);
    });
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
