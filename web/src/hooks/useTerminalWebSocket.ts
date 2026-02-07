import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { Terminal } from '@xterm/xterm';

// Auto-detect WebSocket URL based on page protocol
const WS_BASE = import.meta.env.DEV
  ? 'wss://localhost:3001/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 30000;
const PING_INTERVAL = 30000;

/** Binary protocol type prefixes (must match server) */
const BIN_TYPE_OUTPUT = 0x01;
const BIN_TYPE_INPUT = 0x02;
const BIN_TYPE_SCROLLBACK = 0x03;
const BIN_TYPE_SCROLLBACK_CONTENT = 0x04;

/** Encode a string as binary with 1-byte type prefix */
function encodeBinaryMessage(typePrefix: number, data: string): ArrayBuffer {
  const encoder = new TextEncoder();
  const payload = encoder.encode(data);
  const buf = new Uint8Array(1 + payload.length);
  buf[0] = typePrefix;
  buf.set(payload, 1);
  return buf.buffer;
}

export function useTerminalWebSocket(
  terminalRef: React.RefObject<Terminal | null>,
  sessionId: string,
  onScrollbackContent?: (data: string) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_MIN);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const authFailedRef = useRef(false);
  const onScrollbackRef = useRef(onScrollbackContent);
  const intentionalCloseRef = useRef(false);
  const pingSentAtRef = useRef<number>(0);

  // Keep callback ref in sync
  onScrollbackRef.current = onScrollbackContent;

  const cleanup = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    const { token: currentToken, setTerminalConnected, setTerminalError } = useStore.getState();
    if (!currentToken) return;

    if (authFailedRef.current) return;

    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    }

    intentionalCloseRef.current = false;

    // Token is sent via first-message auth, not in the URL
    // cols/rows are synced via resize message after connection
    const wsUrl = `${WS_BASE}?sessionId=${encodeURIComponent(sessionId)}`;
    console.log(`[WS:${sessionId}] Connecting...`);
    const ws = new WebSocket(wsUrl);

    // Use arraybuffer for binary protocol support
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log(`[WS:${sessionId}] Connected, sending auth...`);
      // Send auth as first message (JSON - control message)
      ws.send(JSON.stringify({ type: 'auth', token: currentToken }));

      setTerminalConnected(sessionId, true);
      setTerminalError(sessionId, null);
      reconnectDelayRef.current = RECONNECT_MIN;

      // Ping immediately to get initial latency, then at interval
      if (ws.readyState === WebSocket.OPEN) {
        pingSentAtRef.current = performance.now();
        ws.send(JSON.stringify({ type: 'ping' }));
      }
      pingTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          pingSentAtRef.current = performance.now();
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);
    };

    ws.onclose = (event) => {
      console.log(`[WS:${sessionId}] Disconnected, code:`, event.code);
      const { setTerminalConnected: setConn, setTerminalError: setErr, setToken: setTk } = useStore.getState();
      setConn(sessionId, false);
      cleanup();

      // Don't reconnect if we intentionally closed
      if (intentionalCloseRef.current) return;

      if (event.code === 4001) {
        authFailedRef.current = true;
        setErr(sessionId, 'Authentication failed');
        setTk(null);
        localStorage.removeItem('cli-online-token');
        return;
      }

      if (event.code === 4002) {
        return;
      }

      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX);
      console.log(`[WS:${sessionId}] Reconnecting in ${delay}ms...`);
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    ws.onmessage = (event) => {
      try {
        const terminal = terminalRef.current;

        // Binary hot-path: [1-byte type prefix][raw payload]
        if (event.data instanceof ArrayBuffer) {
          const view = new Uint8Array(event.data);
          if (view.length < 1) return;
          const typePrefix = view[0];
          const payload = view.subarray(1);

          switch (typePrefix) {
            case BIN_TYPE_OUTPUT:
              // Write raw Uint8Array directly to xterm (zero-copy, no string decode)
              terminal?.write(payload);
              break;
            case BIN_TYPE_SCROLLBACK:
              terminal?.write(payload);
              break;
            case BIN_TYPE_SCROLLBACK_CONTENT: {
              const decoder = new TextDecoder();
              onScrollbackRef.current?.(decoder.decode(payload));
              break;
            }
          }
          return;
        }

        // JSON control messages (low-frequency)
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'connected':
            useStore.getState().setTerminalResumed(sessionId, msg.resumed);
            // Send resize immediately now that session is ready (no 300ms delay)
            {
              const term = terminalRef.current;
              if (term && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
              }
            }
            break;
          case 'error':
            useStore.getState().setTerminalError(sessionId, msg.error);
            break;
          case 'pong': {
            if (pingSentAtRef.current > 0) {
              const rtt = Math.round(performance.now() - pingSentAtRef.current);
              useStore.getState().setLatency(rtt);
              pingSentAtRef.current = 0;
            }
            break;
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    wsRef.current = ws;
  }, [sessionId, terminalRef, cleanup]);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Binary protocol for input hot path (eliminates JSON overhead per keystroke)
      wsRef.current.send(encodeBinaryMessage(BIN_TYPE_INPUT, data));
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }, []);

  const requestScrollback = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'capture-scrollback' }));
    }
  }, []);

  // Connect when token is available
  useEffect(() => {
    const token = useStore.getState().token;
    if (token) {
      authFailedRef.current = false;
      connect();
    }

    return () => {
      intentionalCloseRef.current = true;
      cleanup();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, cleanup]);

  return { sendInput, sendResize, requestScrollback };
}
