import express from 'express';
import compression from 'compression';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket, clearWsIntervals } from './websocket.js';
import { isTmuxAvailable, cleanupStaleSessions } from './tmux.js';
import { cleanupOldDrafts, cleanupOldAnnotations, closeDb } from './db.js';
import { safeTokenCompare } from './auth.js';

// Route modules
import sessionsRouter from './routes/sessions.js';
import filesRouter from './routes/files.js';
import editorRouter from './routes/editor.js';
import settingsRouter from './routes/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

config();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const DEFAULT_WORKING_DIR = process.env.DEFAULT_WORKING_DIR || process.env.HOME || '/home/ubuntu';
const HTTPS_ENABLED = process.env.HTTPS_ENABLED !== 'false';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';
const TRUST_PROXY = process.env.TRUST_PROXY || '';
const MAX_CONNECTIONS = parseInt(process.env.MAX_CONNECTIONS || '10', 10);
const SESSION_TTL_HOURS = parseInt(process.env.SESSION_TTL_HOURS || '24', 10);
const RATE_LIMIT_READ = parseInt(process.env.RATE_LIMIT_READ || '300', 10);
const RATE_LIMIT_WRITE = parseInt(process.env.RATE_LIMIT_WRITE || '100', 10);

const CERT_PATH = join(__dirname, '../certs/server.crt');
const KEY_PATH = join(__dirname, '../certs/server.key');

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
});

async function main() {
  if (!isTmuxAvailable()) {
    console.error('ERROR: tmux is not available. Please install it first.');
    console.error('Run: sudo apt install tmux');
    process.exit(1);
  }
  console.log('tmux is available');

  const app = express();

  if (TRUST_PROXY) {
    app.set('trust proxy', parseInt(TRUST_PROXY, 10) || TRUST_PROXY);
  }

  // --- Middleware ---

  app.use(compression());

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

  // Separate rate limiters for read (GET) and write (POST/PUT/DELETE) so polling doesn't starve writes
  const rlOpts = { windowMs: 60 * 1000, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests' } };
  const readLimiter = rateLimit({ ...rlOpts, max: RATE_LIMIT_READ });
  const writeLimiter = rateLimit({ ...rlOpts, max: RATE_LIMIT_WRITE });
  app.use('/api/', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return readLimiter(req, res, next);
    return writeLimiter(req, res, next);
  });

  // Default JSON body parser; file-content PUT has its own larger-limit parser in editor router
  const defaultJsonParser = express.json({ limit: '256kb' });
  app.use((req, res, next) => {
    if (req.method === 'PUT' && req.path.endsWith('/file-content')) return next();
    defaultJsonParser(req, res, next);
  });

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

  // --- Routes ---

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(sessionsRouter);
  app.use(filesRouter);
  app.use(editorRouter);
  app.use(settingsRouter);

  // --- Static files ---

  const webDistPath = join(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath, {
      maxAge: '1y',
      immutable: true,
      index: false,
    }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(webDistPath, 'index.html'));
    });
    console.log('Serving static files from:', webDistPath);
  }

  // --- Server startup ---

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

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 1024 * 1024,
    perMessageDeflate: {
      zlibDeflateOptions: { level: 1 },
      threshold: 128,
      concurrencyLimit: 10,
      clientNoContextTakeover: true,
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

  // --- Cleanup ---

  try {
    const purged = cleanupOldDrafts(7);
    if (purged > 0) console.log(`[startup] Cleaned up ${purged} stale drafts`);
  } catch (e) { console.error('[startup:drafts]', e); }

  let cleanupTimer: ReturnType<typeof setInterval> | null = null;
  if (SESSION_TTL_HOURS > 0) {
    const CLEANUP_INTERVAL = 60 * 60 * 1000;
    cleanupTimer = setInterval(() => {
      cleanupStaleSessions(SESSION_TTL_HOURS).catch((e) => console.error('[cleanup]', e));
      try { cleanupOldDrafts(7); } catch (e) { console.error('[cleanup:drafts]', e); }
      try { cleanupOldAnnotations(7); } catch (e) { console.error('[cleanup:annotations]', e); }
    }, CLEANUP_INTERVAL);
    console.log(`Session TTL: ${SESSION_TTL_HOURS}h (cleanup every hour)`);
  }

  // --- Graceful shutdown ---

  const shutdown = () => {
    console.log('\n[shutdown] Closing server...');
    clearWsIntervals();
    if (cleanupTimer) clearInterval(cleanupTimer);
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    setTimeout(() => {
      server.close(() => {
        try { closeDb(); } catch { /* ignore */ }
        console.log('[shutdown] Server closed');
        process.exit(0);
      });
    }, 500);
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
