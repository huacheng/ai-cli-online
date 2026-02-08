import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';
import {
  buildSessionName,
  isValidSessionId,
  tokenToSessionName,
  hasSession,
  createSession,
  captureScrollback,
  resizeSession,
} from './tmux.js';
import { PtySession } from './pty.js';
import type { ClientMessage, ServerMessage } from './types.js';

/** WebSocket with keepalive flag for server-side ping/pong tracking */
interface AliveWebSocket extends WebSocket {
  _isAlive: boolean;
}

/**
 * Binary protocol for hot-path messages (output/input/scrollback).
 * Format: [1-byte type prefix][raw UTF-8 payload]
 * JSON is kept for low-frequency control messages.
 */
const BIN_TYPE_OUTPUT = 0x01;
const BIN_TYPE_INPUT = 0x02;
const BIN_TYPE_SCROLLBACK = 0x03;
const BIN_TYPE_SCROLLBACK_CONTENT = 0x04;

/** Track active connections per session name to prevent duplicates */
const activeConnections = new Map<string, WebSocket>();

/** Rate-limit failed WebSocket auth attempts per IP */
const authFailures = new Map<string, { count: number; resetAt: number }>();
const AUTH_FAIL_MAX = 5;
const AUTH_FAIL_WINDOW_MS = 60_000;

// Periodically prune expired entries to prevent unbounded memory growth
const authPruneInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authFailures) {
    if (now > entry.resetAt) authFailures.delete(ip);
  }
}, 5 * 60_000);

function isAuthRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || now > entry.resetAt) return false;
  return entry.count >= AUTH_FAIL_MAX;
}

function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const entry = authFailures.get(ip);
  if (!entry || now > entry.resetAt) {
    authFailures.set(ip, { count: 1, resetAt: now + AUTH_FAIL_WINDOW_MS });
  } else {
    entry.count++;
  }
}

/** Count active connections for a given token prefix */
function countConnectionsForToken(tokenPrefix: string): number {
  let count = 0;
  for (const [name, ws] of activeConnections) {
    if (name.startsWith(tokenPrefix) && ws.readyState === WebSocket.OPEN) {
      count++;
    }
  }
  return count;
}

/** Get the set of session names with active open WebSocket connections */
export function getActiveSessionNames(): Set<string> {
  const names = new Set<string>();
  for (const [name, ws] of activeConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      names.add(name);
    }
  }
  return names;
}

/** Send a JSON control message (low-frequency: connected, error, pong) */
function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** Send binary data with a 1-byte type prefix (high-frequency hot path) */
function sendBinary(ws: WebSocket, typePrefix: number, data: string): void {
  if (ws.readyState === WebSocket.OPEN) {
    const byteLen = Buffer.byteLength(data, 'utf-8');
    const buf = Buffer.allocUnsafe(1 + byteLen);
    buf[0] = typePrefix;
    buf.write(data, 1, byteLen, 'utf-8');
    ws.send(buf);
  }
}

/** Server-side keepalive: ping all clients every 30s, terminate if no pong */
let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
function startKeepAlive(wss: WebSocketServer): void {
  const KEEPALIVE_INTERVAL = 30_000;

  keepAliveInterval = setInterval(() => {
    for (const ws of wss.clients) {
      const alive = ws as AliveWebSocket;
      if (alive._isAlive === false) {
        // No pong received since last ping — terminate
        console.log('[WS] Keepalive: terminating unresponsive connection');
        alive.terminate();
        continue;
      }
      alive._isAlive = false;
      alive.ping();
    }
  }, KEEPALIVE_INTERVAL);

  wss.on('connection', (ws) => {
    (ws as AliveWebSocket)._isAlive = true;
    ws.on('pong', () => {
      (ws as AliveWebSocket)._isAlive = true;
    });
  });
}

export function setupWebSocket(
  wss: WebSocketServer,
  authToken: string,
  defaultCwd: string,
  tokenCompare: (a: string, b: string) => boolean,
  maxConnections = 10,
): void {
  // Start server-side keepalive to detect dead connections
  startKeepAlive(wss);

  const compareToken = tokenCompare;
  wss.on('connection', (ws, req: IncomingMessage) => {
    // Disable Nagle algorithm for low-latency terminal I/O (eliminates up to 40ms delay per keystroke)
    const socket = req.socket as Socket;
    if (socket && typeof socket.setNoDelay === 'function') {
      socket.setNoDelay(true);
    }

    const clientIp = req.socket.remoteAddress || 'unknown';

    // Reject connections from IPs with too many recent auth failures
    if (authToken && isAuthRateLimited(clientIp)) {
      console.log(`[WS] Auth rate-limited IP: ${clientIp}`);
      ws.close(4001, 'Too many auth failures');
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const cols = 80;
    const rows = 24;
    const rawSessionId = url.searchParams.get('sessionId') || undefined;
    const sessionId = rawSessionId && isValidSessionId(rawSessionId) ? rawSessionId : undefined;

    if (rawSessionId && !sessionId) {
      console.log(`[WS] Invalid sessionId rejected: ${rawSessionId}`);
      ws.close(4004, 'Invalid sessionId');
      return;
    }

    // First-message auth: wait for { type: 'auth', token } before setting up session.
    // A 5-second timeout ensures unauthenticated connections don't linger.
    let authenticated = !authToken; // skip auth if no token configured
    let sessionName = '';
    let ptySession: PtySession | null = null;
    let sessionInitializing = false; // guard against concurrent initSession calls
    let lastScrollbackTime = 0; // throttle capture-scrollback requests
    const SCROLLBACK_THROTTLE_MS = 2000;
    const AUTH_TIMEOUT = 5000;

    const authTimer = authToken
      ? setTimeout(() => {
          if (!authenticated) {
            console.log('[WS] Auth timeout — no auth message received');
            ws.close(4001, 'Auth timeout');
          }
        }, AUTH_TIMEOUT)
      : null;

    async function initSession(token: string) {
      if (sessionInitializing || ptySession) return; // prevent double init
      sessionInitializing = true;
      try {
        sessionName = buildSessionName(token, sessionId);

        // Connection limit per token
        const tokenPrefix = tokenToSessionName(token) + '-';
        if (countConnectionsForToken(tokenPrefix) >= maxConnections) {
          console.log(`[WS] Connection limit (${maxConnections}) reached for token`);
          ws.close(4005, 'Too many connections');
          return;
        }

        console.log(`[WS] Client connected, session: ${sessionName}, size: ${cols}x${rows}`);

        // Kick duplicate connection for same session
        const existing = activeConnections.get(sessionName);
        if (existing && existing.readyState === WebSocket.OPEN) {
          console.log(`[WS] Kicking existing connection for session: ${sessionName}`);
          existing.close(4002, 'Replaced by new connection');
        }
        activeConnections.set(sessionName, ws);

        // Check or create tmux session
        const resumed = await hasSession(sessionName);
        if (!resumed) {
          await createSession(sessionName, cols, rows, defaultCwd);
        } else {
          // resizeSession and captureScrollback are independent — run in parallel
          const [, scrollback] = await Promise.all([
            resizeSession(sessionName, cols, rows),
            captureScrollback(sessionName),
          ]);
          if (scrollback) {
            sendBinary(ws, BIN_TYPE_SCROLLBACK, scrollback);
          }
        }

        send(ws, { type: 'connected', resumed });

        // Attach PTY to tmux session
        try {
          ptySession = new PtySession(sessionName, cols, rows);
        } catch (err) {
          console.error(`[WS] Failed to attach PTY to session ${sessionName}:`, err);
          send(ws, { type: 'error', error: 'Failed to attach to terminal session' });
          ws.close(4003, 'PTY attach failed');
          return;
        }

        ptySession.onData((data) => {
          sendBinary(ws, BIN_TYPE_OUTPUT, data);
        });

        ptySession.onExit((code, signal) => {
          console.log(`[WS] PTY exited for session ${sessionName}, code: ${code}, signal: ${signal}`);
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'PTY exited');
          }
        });
      } catch (err) {
        console.error(`[WS] initSession failed for ${sessionName}:`, err);
        ws.close(4003, 'Session init failed');
      } finally {
        sessionInitializing = false;
      }
    }

    // If no auth required, init immediately with default token
    if (authenticated) {
      initSession('default');
    }

    ws.on('message', async (raw, isBinary) => {
      try {
        // Binary hot-path: [1-byte type][payload]
        if (isBinary && Buffer.isBuffer(raw) && raw.length >= 1) {
          if (!authenticated) {
            ws.close(4001, 'Auth required');
            return;
          }
          const typePrefix = raw[0];
          if (typePrefix === BIN_TYPE_INPUT) {
            const data = raw.subarray(1).toString('utf-8');
            ptySession?.write(data);
          }
          return;
        }

        // JSON control messages
        const msg: ClientMessage = JSON.parse(raw.toString());

        // Handle auth message (must be first message when auth is enabled)
        if (msg.type === 'auth') {
          if (authenticated) return; // already authenticated, ignore
          if (authTimer) clearTimeout(authTimer);
          if (!msg.token || !compareToken(msg.token, authToken)) {
            recordAuthFailure(clientIp);
            console.log(`[WS] Unauthorized — invalid token from ${clientIp}`);
            ws.close(4001, 'Unauthorized');
            return;
          }
          authenticated = true;
          await initSession(msg.token);
          return;
        }

        // All other messages require authentication
        if (!authenticated) {
          ws.close(4001, 'Auth required');
          return;
        }

        switch (msg.type) {
          case 'input':
            // Legacy JSON input support (fallback)
            ptySession?.write(msg.data);
            break;
          case 'resize': {
            const c = Math.max(1, Math.min(500, Math.floor(msg.cols || 80)));
            const r = Math.max(1, Math.min(500, Math.floor(msg.rows || 24)));
            // PTY resize (sync) and tmux resize (async subprocess) are independent — run in parallel
            ptySession?.resize(c, r);
            resizeSession(sessionName, c, r).catch(() => {});
            break;
          }
          case 'ping':
            send(ws, { type: 'pong', timestamp: Date.now() });
            break;
          case 'capture-scrollback': {
            // Throttle to prevent abuse (subprocess spawning is expensive)
            const now = Date.now();
            if (now - lastScrollbackTime < SCROLLBACK_THROTTLE_MS) break;
            lastScrollbackTime = now;
            const content = await captureScrollback(sessionName);
            // Normalize newlines server-side to avoid client main-thread regex on large strings
            const normalized = content.replace(/\n/g, '\r\n');
            sendBinary(ws, BIN_TYPE_SCROLLBACK_CONTENT, normalized);
            break;
          }
        }
      } catch (err) {
        console.error(`[WS] Message handling error${sessionName ? ` for ${sessionName}` : ''}:`, err);
      }
    });

    ws.on('close', () => {
      if (authTimer) clearTimeout(authTimer);
      if (sessionName) {
        console.log(`[WS] Client disconnected, session: ${sessionName}`);
        if (activeConnections.get(sessionName) === ws) {
          activeConnections.delete(sessionName);
        }
      }
      ptySession?.kill();
      ptySession = null;
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error${sessionName ? ` for session ${sessionName}` : ''}:`, err);
    });
  });
}

/** Clear WebSocket module intervals for graceful shutdown */
export function clearWsIntervals(): void {
  clearInterval(authPruneInterval);
  if (keepAliveInterval) clearInterval(keepAliveInterval);
}
