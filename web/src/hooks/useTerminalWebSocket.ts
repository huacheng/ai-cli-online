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

  const {
    setTerminalConnected,
    setTerminalResumed,
    setTerminalError,
    setToken,
  } = useStore();

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
    const currentToken = useStore.getState().token;
    if (!currentToken) return;

    if (authFailedRef.current) return;

    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    }

    const terminal = terminalRef.current;
    const cols = terminal?.cols || 80;
    const rows = terminal?.rows || 24;

    const wsUrl = `${WS_BASE}?token=${encodeURIComponent(currentToken)}&cols=${cols}&rows=${rows}&sessionId=${encodeURIComponent(sessionId)}`;
    console.log(`[WS:${sessionId}] Connecting...`);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log(`[WS:${sessionId}] Connected`);
      setTerminalConnected(sessionId, true);
      setTerminalError(sessionId, null);
      reconnectDelayRef.current = RECONNECT_MIN;

      // Sync actual terminal dimensions after connection.
      // The initial URL params may have used defaults (80x24) because
      // the terminal wasn't created/fit yet when connect() was called.
      setTimeout(() => {
        const term = terminalRef.current;
        if (term && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      }, 300);

      pingTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);
    };

    ws.onclose = (event) => {
      console.log(`[WS:${sessionId}] Disconnected, code:`, event.code);
      setTerminalConnected(sessionId, false);
      cleanup();

      if (event.code === 4001) {
        authFailedRef.current = true;
        setTerminalError(sessionId, 'Authentication failed');
        setToken(null);
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
        const msg = JSON.parse(event.data);
        const terminal = terminalRef.current;

        switch (msg.type) {
          case 'output':
            terminal?.write(msg.data);
            break;
          case 'scrollback':
            terminal?.write(msg.data);
            break;
          case 'connected':
            setTerminalResumed(sessionId, msg.resumed);
            break;
          case 'error':
            setTerminalError(sessionId, msg.error);
            break;
          case 'scrollback-content':
            onScrollbackContent?.(msg.data);
            break;
          case 'pong':
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    wsRef.current = ws;
  }, [terminalRef, sessionId, setTerminalConnected, setTerminalResumed, setTerminalError, setToken, cleanup, onScrollbackContent]);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }));
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
      cleanup();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, cleanup]);

  return { sendInput, sendResize, requestScrollback };
}
