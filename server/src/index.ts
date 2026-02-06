import express from 'express';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { timingSafeEqual } from 'crypto';
import { setupWebSocket, getActiveSessionNames } from './websocket.js';
import { isTmuxAvailable, listSessions, buildSessionName, killSession, isValidSessionId, cleanupStaleSessions } from './tmux.js';

/** Constant-time string comparison to prevent timing side-channel attacks */
function safeTokenCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

const __dirname = dirname(fileURLToPath(import.meta.url));

config();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const DEFAULT_WORKING_DIR = process.env.DEFAULT_WORKING_DIR || process.env.HOME || '/home/ubuntu';
const HTTPS_ENABLED = process.env.HTTPS_ENABLED !== 'false';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
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

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Auth check helper
  function checkAuth(req: express.Request, res: express.Response): boolean {
    if (!AUTH_TOKEN) return true;
    const token = req.query.token as string | undefined;
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
    const token = (req.query.token as string) || 'default';
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
    const token = (req.query.token as string) || 'default';
    const sessionName = buildSessionName(token, req.params.sessionId);
    await killSession(sessionName);
    res.json({ ok: true });
  });

  // Serve static files from web/dist in production
  const webDistPath = join(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(join(webDistPath, 'index.html'));
    });
    console.log('Serving static files from:', webDistPath);
  }

  // SSL setup
  const hasSSL = existsSync(CERT_PATH) && existsSync(KEY_PATH);
  const useHttps = HTTPS_ENABLED && hasSSL;

  let server;
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

  // WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
  setupWebSocket(wss, AUTH_TOKEN, DEFAULT_WORKING_DIR, safeTokenCompare, MAX_CONNECTIONS);

  const protocol = useHttps ? 'https' : 'http';
  const wsProtocol = useHttps ? 'wss' : 'ws';

  server.listen(Number(PORT), HOST, () => {
    console.log('');
    console.log('='.repeat(50));
    console.log('  CLI-Online Terminal Server');
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
    setInterval(() => cleanupStaleSessions(SESSION_TTL_HOURS), CLEANUP_INTERVAL);
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
