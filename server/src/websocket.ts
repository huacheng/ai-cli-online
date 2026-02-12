import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';
import {
  buildSessionName,
  isValidSessionId,
  tokenToSessionName,
  hasSession,
  createSession,
  configureSession,
  captureScrollback,
  resizeSession,
  getCwd,
} from './tmux.js';
import { validatePathNoSymlink } from './files.js';
import { createReadStream, type ReadStream } from 'fs';
import { stat as fsStat } from 'fs/promises';
import { PtySession } from './pty.js';
import type { ClientMessage, ServerMessage } from './types.js';

/** WebSocket with keepalive flag for server-side ping/pong tracking */
interface AliveWebSocket extends WebSocket {
  _isAlive: boolean;
}

import { BIN_TYPE_OUTPUT, BIN_TYPE_INPUT, BIN_TYPE_SCROLLBACK, BIN_TYPE_SCROLLBACK_CONTENT, BIN_TYPE_FILE_CHUNK } from 'ai-cli-online-shared';

// A2: Limit pending (unauthenticated) WebSocket connections
const MAX_PENDING_AUTH = 50;
let pendingAuthCount = 0;

const MAX_STREAM_SIZE = 50 * 1024 * 1024; // 50MB
const STREAM_CHUNK_SIZE = 64 * 1024;      // 64KB highWaterMark
const STREAM_HIGH_WATER = 1024 * 1024;    // 1MB backpressure threshold
const STREAM_LOW_WATER = 512 * 1024;      // 512KB resume threshold

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
  const KEEPALIVE_INTERVAL = 20_000;

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

    // A2: Reject when too many unauthenticated connections are pending
    let countedAsPending = false;
    if (authToken) {
      if (pendingAuthCount >= MAX_PENDING_AUTH) {
        console.log(`[WS] Pending auth limit (${MAX_PENDING_AUTH}) reached, rejecting connection from ${clientIp}`);
        ws.close(4006, 'Too many pending connections');
        return;
      }
      pendingAuthCount++;
      countedAsPending = true;
    }

    // Reject connections from IPs with too many recent auth failures
    if (authToken && isAuthRateLimited(clientIp)) {
      console.log(`[WS] Auth rate-limited IP: ${clientIp}`);
      if (countedAsPending) { pendingAuthCount--; countedAsPending = false; }
      ws.close(4001, 'Too many auth failures');
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const cols = 80;
    const rows = 24;
    const rawSessionId = url.searchParams.get('sessionId') || undefined;
    const sessionId = rawSessionId && isValidSessionId(rawSessionId) ? rawSessionId : undefined;
    const clientCwd = url.searchParams.get('cwd') || undefined;

    if (rawSessionId && !sessionId) {
      console.log(`[WS] Invalid sessionId rejected: ${rawSessionId}`);
      ws.close(4004, 'Invalid sessionId');
      return;
    }

    // First-message auth: wait for { type: 'auth', token } before setting up session.
    // A 5-second timeout ensures unauthenticated connections don't linger.
    let authenticated = !authToken; // skip auth if no token configured
    let authenticatedToken = '';    // saved for buildSessionName in stream-file
    let sessionName = '';
    let ptySession: PtySession | null = null;
    let sessionInitializing = false; // guard against concurrent initSession calls
    let lastScrollbackTime = 0; // throttle capture-scrollback requests
    let activeFileStream: ReadStream | null = null;
    const SCROLLBACK_THROTTLE_MS = 2000;
    const AUTH_TIMEOUT = 5000;

    const authTimer = authToken
      ? setTimeout(() => {
          if (!authenticated) {
            if (countedAsPending) { pendingAuthCount--; countedAsPending = false; }
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
          await createSession(sessionName, cols, rows, clientCwd || defaultCwd);
        } else {
          // resizeSession, captureScrollback, and configureSession are independent — run in parallel
          const [, scrollback] = await Promise.all([
            resizeSession(sessionName, cols, rows),
            captureScrollback(sessionName),
            configureSession(sessionName),
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

        // Backpressure: pause PTY when WebSocket send buffer is full
        const HIGH_WATER_MARK = 1024 * 1024; // 1MB
        let ptyPaused = false;
        ptySession.onData((data) => {
          sendBinary(ws, BIN_TYPE_OUTPUT, data);
          if (!ptyPaused && ws.bufferedAmount > HIGH_WATER_MARK) {
            ptyPaused = true;
            ptySession!.pause();
          }
        });
        // Resume PTY when WebSocket buffer drains
        ws.on('drain', () => {
          if (ptyPaused && ws.bufferedAmount < HIGH_WATER_MARK / 2) {
            ptyPaused = false;
            ptySession?.resume();
          }
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
            if (countedAsPending) { pendingAuthCount--; countedAsPending = false; }
            ws.close(4001, 'Unauthorized');
            return;
          }
          if (countedAsPending) { pendingAuthCount--; countedAsPending = false; }
          authenticated = true;
          authenticatedToken = msg.token;
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
          case 'stream-file': {
            // Cancel any existing stream
            if (activeFileStream) {
              activeFileStream.destroy();
              activeFileStream = null;
            }

            try {
              const cwd = await getCwd(sessionName);
              const resolved = await validatePathNoSymlink(msg.path, cwd);
              if (!resolved) {
                send(ws, { type: 'file-stream-error', error: 'Invalid path' });
                break;
              }

              const fileStat = await fsStat(resolved);
              if (!fileStat.isFile()) {
                send(ws, { type: 'file-stream-error', error: 'Not a file' });
                break;
              }
              if (fileStat.size > MAX_STREAM_SIZE) {
                send(ws, { type: 'file-stream-error', error: `File too large (${(fileStat.size / 1024 / 1024).toFixed(1)}MB > 50MB limit)` });
                break;
              }

              send(ws, { type: 'file-stream-start', size: fileStat.size, mtime: fileStat.mtimeMs });

              const stream = createReadStream(resolved, { highWaterMark: STREAM_CHUNK_SIZE });
              activeFileStream = stream;

              stream.on('data', (chunk: Buffer | string) => {
                const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                if (ws.readyState !== WebSocket.OPEN) {
                  stream.destroy();
                  return;
                }
                const buf = Buffer.allocUnsafe(1 + data.length);
                buf[0] = BIN_TYPE_FILE_CHUNK;
                buf.set(data, 1);
                ws.send(buf);

                // Backpressure: pause stream when WS send buffer is full, resume on drain
                if (ws.bufferedAmount > STREAM_HIGH_WATER) {
                  stream.pause();
                  const onDrain = () => {
                    if (ws.bufferedAmount < STREAM_LOW_WATER) {
                      stream.resume();
                    } else {
                      ws.once('drain', onDrain);
                    }
                  };
                  ws.once('drain', onDrain);
                }
              });

              stream.on('end', () => {
                activeFileStream = null;
                send(ws, { type: 'file-stream-end' });
              });

              stream.on('error', (err) => {
                activeFileStream = null;
                send(ws, { type: 'file-stream-error', error: err.message });
              });
            } catch (err) {
              send(ws, { type: 'file-stream-error', error: err instanceof Error ? err.message : 'Stream failed' });
            }
            break;
          }
          case 'cancel-stream': {
            if (activeFileStream) {
              activeFileStream.destroy();
              activeFileStream = null;
            }
            break;
          }
        }
      } catch (err) {
        console.error(`[WS] Message handling error${sessionName ? ` for ${sessionName}` : ''}:`, err);
      }
    });

    ws.on('close', () => {
      if (countedAsPending) { pendingAuthCount--; countedAsPending = false; }
      if (authTimer) clearTimeout(authTimer);
      if (activeFileStream) {
        activeFileStream.destroy();
        activeFileStream = null;
      }
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
