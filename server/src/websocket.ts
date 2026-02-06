import { WebSocket, WebSocketServer } from 'ws';
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

/** Track active connections per session name to prevent duplicates */
const activeConnections = new Map<string, WebSocket>();

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

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function setupWebSocket(
  wss: WebSocketServer,
  authToken: string,
  defaultCwd: string,
  tokenCompare?: (a: string, b: string) => boolean,
  maxConnections = 10,
): void {
  const compareToken = tokenCompare || ((a: string, b: string) => a === b);
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    let cols = 80;
    let rows = 24;
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
        await resizeSession(sessionName, cols, rows);
      }

      // Send scrollback for resumed sessions
      if (resumed) {
        const scrollback = await captureScrollback(sessionName);
        if (scrollback) {
          send(ws, { type: 'scrollback', data: scrollback });
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
        send(ws, { type: 'output', data });
      });

      ptySession.onExit((code, signal) => {
        console.log(`[WS] PTY exited for session ${sessionName}, code: ${code}, signal: ${signal}`);
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, 'PTY exited');
        }
      });
    }

    // If no auth required, init immediately with default token
    if (authenticated) {
      initSession('default');
    }

    ws.on('message', async (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        // Handle auth message (must be first message when auth is enabled)
        if (msg.type === 'auth') {
          if (authenticated) return; // already authenticated, ignore
          if (authTimer) clearTimeout(authTimer);
          if (!msg.token || !compareToken(msg.token, authToken)) {
            console.log('[WS] Unauthorized — invalid token in auth message');
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
            ptySession?.write(msg.data);
            break;
          case 'resize': {
            const c = Math.max(1, Math.min(500, Math.floor(msg.cols || 80)));
            const r = Math.max(1, Math.min(500, Math.floor(msg.rows || 24)));
            ptySession?.resize(c, r);
            await resizeSession(sessionName, c, r);
            break;
          }
          case 'ping':
            send(ws, { type: 'pong', timestamp: Date.now() });
            break;
          case 'capture-scrollback': {
            const content = await captureScrollback(sessionName);
            send(ws, { type: 'scrollback-content', data: content });
            break;
          }
        }
      } catch {
        // Ignore malformed messages
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
