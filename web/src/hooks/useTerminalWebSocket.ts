import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { Terminal } from '@xterm/xterm';

// Auto-detect WebSocket URL based on page protocol (works for both dev proxy and production)
const WS_BASE = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const RECONNECT_MIN = 500;
const RECONNECT_MAX = 15000;
const PING_INTERVAL = 15000;
const PONG_TIMEOUT = 5000;
const CONNECT_TIMEOUT = 10000;
const INPUT_BATCH_MS = 5;
const MAX_INPUT_BUFFER = 64 * 1024;

/** Binary protocol type prefixes (must match server) */
const BIN_TYPE_OUTPUT = 0x01;
const BIN_TYPE_INPUT = 0x02;
const BIN_TYPE_SCROLLBACK = 0x03;
const BIN_TYPE_SCROLLBACK_CONTENT = 0x04;

/** Shared TextDecoder/TextEncoder instances (avoids per-message allocation) */
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** Encode a string as binary with 1-byte type prefix */
function encodeBinaryMessage(typePrefix: number, data: string): ArrayBuffer {
  const payload = textEncoder.encode(data);
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
  const pongTimeoutRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const authFailedRef = useRef(false);
  const onScrollbackRef = useRef(onScrollbackContent);
  const intentionalCloseRef = useRef(false);
  const pingSentAtRef = useRef<number>(0);

  // Input batching: accumulate keystrokes within INPUT_BATCH_MS and send as one frame
  const inputBatchRef = useRef<string>('');
  const inputBatchTimerRef = useRef<number | null>(null);

  // Input buffer: queue input during disconnection, flush on reconnect
  const inputBufferRef = useRef<string>('');

  // Keep callback ref in sync
  onScrollbackRef.current = onScrollbackContent;

  const cleanup = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (inputBatchTimerRef.current) {
      clearTimeout(inputBatchTimerRef.current);
      inputBatchTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    const { token: currentToken, setTerminalError } = useStore.getState();
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

    // Connection timeout: abort if WebSocket doesn't open within CONNECT_TIMEOUT
    connectTimeoutRef.current = window.setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        console.log(`[WS:${sessionId}] Connection timeout (${CONNECT_TIMEOUT}ms), aborting...`);
        ws.close();
      }
    }, CONNECT_TIMEOUT);

    // Ping with pong timeout for stale connection detection
    // Defined at connect() scope so both onopen and onmessage can access it
    const sendPing = () => {
      if (ws.readyState === WebSocket.OPEN) {
        pingSentAtRef.current = performance.now();
        ws.send(JSON.stringify({ type: 'ping' }));
        // If no pong within PONG_TIMEOUT, consider connection dead
        pongTimeoutRef.current = window.setTimeout(() => {
          if (pingSentAtRef.current > 0) {
            console.log(`[WS:${sessionId}] Pong timeout (${PONG_TIMEOUT}ms), reconnecting...`);
            pingSentAtRef.current = 0;
            ws.close();
          }
        }, PONG_TIMEOUT);
      }
    };

    ws.onopen = () => {
      // Clear connection timeout
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }

      console.log(`[WS:${sessionId}] Connected, sending auth...`);
      // Send auth as first message (JSON - control message)
      ws.send(JSON.stringify({ type: 'auth', token: currentToken }));

      // Clear error and reset reconnect delay, but do NOT mark as connected yet —
      // wait for server 'connected' message which confirms session is ready
      setTerminalError(sessionId, null);
      reconnectDelayRef.current = RECONNECT_MIN;
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
        localStorage.removeItem('ai-cli-online-token');
        return;
      }

      if (event.code === 4002) {
        return;
      }

      if (event.code === 4005) {
        setErr(sessionId, 'Connection limit reached');
        return; // Don't reconnect — would just hit the limit again
      }

      const baseDelay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(baseDelay * 2, RECONNECT_MAX);
      // Add jitter (50-150% of base delay) to prevent thundering herd on mass reconnect
      const delay = Math.round(baseDelay * (0.5 + Math.random()));
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
              onScrollbackRef.current?.(textDecoder.decode(payload));
              break;
            }
          }
          return;
        }

        // JSON control messages (low-frequency)
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'connected': {
            const store = useStore.getState();
            // NOW mark as connected — server session is ready and PTY is attached
            store.setTerminalConnected(sessionId, true);
            store.setTerminalResumed(sessionId, msg.resumed);
            // Send resize immediately now that session is ready (no 300ms delay)
            const term = terminalRef.current;
            if (term && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
            }
            // Flush any input buffered during disconnection — session is ready to receive
            if (inputBufferRef.current) {
              ws.send(encodeBinaryMessage(BIN_TYPE_INPUT, inputBufferRef.current));
              inputBufferRef.current = '';
            }
            // Start ping/pong heartbeat after session is established
            sendPing();
            pingTimerRef.current = window.setInterval(sendPing, PING_INTERVAL);
            break;
          }
          case 'error':
            useStore.getState().setTerminalError(sessionId, msg.error);
            break;
          case 'pong': {
            // Clear pong timeout — connection is alive
            if (pongTimeoutRef.current) {
              clearTimeout(pongTimeoutRef.current);
              pongTimeoutRef.current = null;
            }
            if (pingSentAtRef.current > 0) {
              const rtt = Math.round(performance.now() - pingSentAtRef.current);
              // Only update global latency from the primary (first) terminal to avoid flicker
              const state = useStore.getState();
              if (state.terminalIds.length === 0 || state.terminalIds[0] === sessionId) {
                state.setLatency(rtt);
              }
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
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Buffer input during disconnection — flush on reconnect (capped to prevent unbounded growth)
      if (inputBufferRef.current.length < MAX_INPUT_BUFFER) {
        inputBufferRef.current += data;
      }
      return;
    }
    // Batch keystrokes within INPUT_BATCH_MS window to reduce frame count on high-latency links
    inputBatchRef.current += data;
    if (!inputBatchTimerRef.current) {
      inputBatchTimerRef.current = window.setTimeout(() => {
        const batch = inputBatchRef.current;
        inputBatchRef.current = '';
        inputBatchTimerRef.current = null;
        if (batch && ws.readyState === WebSocket.OPEN) {
          ws.send(encodeBinaryMessage(BIN_TYPE_INPUT, batch));
        }
      }, INPUT_BATCH_MS);
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
