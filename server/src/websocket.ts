import { WebSocket, WebSocketServer } from 'ws';
import {
  buildSessionName,
  isValidSessionId,
  hasSession,
  createSession,
  captureScrollback,
  resizeSession,
} from './tmux.js';
import { PtySession } from './pty.js';
import type { ClientMessage, ServerMessage } from './types.js';

/** Track active connections per session name to prevent duplicates */
const activeConnections = new Map<string, WebSocket>();

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
): void {
  const compareToken = tokenCompare || ((a: string, b: string) => a === b);
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const cols = Math.max(1, parseInt(url.searchParams.get('cols') || '80', 10));
    const rows = Math.max(1, parseInt(url.searchParams.get('rows') || '24', 10));
    const rawSessionId = url.searchParams.get('sessionId') || undefined;
    const sessionId = rawSessionId && isValidSessionId(rawSessionId) ? rawSessionId : undefined;

    if (rawSessionId && !sessionId) {
      console.log(`[WS] Invalid sessionId rejected: ${rawSessionId}`);
      ws.close(4004, 'Invalid sessionId');
      return;
    }

    // Auth check
    if (authToken && (!token || !compareToken(token, authToken))) {
      console.log('[WS] Unauthorized connection attempt');
      ws.close(4001, 'Unauthorized');
      return;
    }

    const sessionName = buildSessionName(token || 'default', sessionId);
    console.log(`[WS] Client connected, session: ${sessionName}, size: ${cols}x${rows}`);

    // Kick duplicate connection for same token
    const existing = activeConnections.get(sessionName);
    if (existing && existing.readyState === WebSocket.OPEN) {
      console.log(`[WS] Kicking existing connection for session: ${sessionName}`);
      existing.close(4002, 'Replaced by new connection');
    }
    activeConnections.set(sessionName, ws);

    // Check or create tmux session
    const resumed = hasSession(sessionName);
    if (!resumed) {
      createSession(sessionName, cols, rows, defaultCwd);
    } else {
      // Resize existing session to match new client
      resizeSession(sessionName, cols, rows);
    }

    // Send scrollback for resumed sessions
    if (resumed) {
      const scrollback = captureScrollback(sessionName);
      if (scrollback) {
        send(ws, { type: 'scrollback', data: scrollback });
      }
    }

    // Notify client of connection status
    send(ws, { type: 'connected', resumed });

    // Attach PTY to tmux session
    let ptySession: PtySession | null = null;
    try {
      ptySession = new PtySession(sessionName, cols, rows);
    } catch (err) {
      console.error(`[WS] Failed to attach PTY to session ${sessionName}:`, err);
      send(ws, { type: 'error', error: 'Failed to attach to terminal session' });
      ws.close(4003, 'PTY attach failed');
      return;
    }

    // PTY → WebSocket relay
    ptySession.onData((data) => {
      send(ws, { type: 'output', data });
    });

    ptySession.onExit((code, signal) => {
      console.log(`[WS] PTY exited for session ${sessionName}, code: ${code}, signal: ${signal}`);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, 'PTY exited');
      }
    });

    // WebSocket → PTY relay
    ws.on('message', (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        switch (msg.type) {
          case 'input':
            ptySession?.write(msg.data);
            break;
          case 'resize': {
            const c = Math.max(1, Math.min(500, Math.floor(msg.cols || 80)));
            const r = Math.max(1, Math.min(500, Math.floor(msg.rows || 24)));
            ptySession?.resize(c, r);
            resizeSession(sessionName, c, r);
            break;
          }
          case 'ping':
            send(ws, { type: 'pong', timestamp: Date.now() });
            break;
          case 'capture-scrollback': {
            const content = captureScrollback(sessionName);
            send(ws, { type: 'scrollback-content', data: content });
            break;
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    // Cleanup on disconnect — kill PTY only (tmux stays alive)
    ws.on('close', () => {
      console.log(`[WS] Client disconnected, session: ${sessionName}`);
      if (activeConnections.get(sessionName) === ws) {
        activeConnections.delete(sessionName);
      }
      ptySession?.kill();
      ptySession = null;
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error for session ${sessionName}:`, err);
    });
  });
}
