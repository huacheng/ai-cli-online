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

// Get token from URL params or localStorage
function getToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem('cli-online-token', urlToken);
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('token');
    window.history.replaceState({}, '', newUrl.toString());
    return urlToken;
  }
  return localStorage.getItem('cli-online-token');
}

export function useTerminalWebSocket(terminalRef: React.RefObject<Terminal | null>) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(RECONNECT_MIN);
  const reconnectTimerRef = useRef<number | null>(null);
  const pingTimerRef = useRef<number | null>(null);
  const authFailedRef = useRef(false);

  const {
    token,
    setToken,
    setConnected,
    setSessionResumed,
    setError,
  } = useStore();

  // Initialize token on mount
  useEffect(() => {
    const savedToken = getToken();
    if (savedToken) {
      setToken(savedToken);
    }
  }, [setToken]);

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

    // Don't reconnect if auth failed
    if (authFailedRef.current) return;

    // Skip if already connected/connecting
    if (wsRef.current) {
      const state = wsRef.current.readyState;
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
    }

    const terminal = terminalRef.current;
    const cols = terminal?.cols || 80;
    const rows = terminal?.rows || 24;

    const wsUrl = `${WS_BASE}?token=${encodeURIComponent(currentToken)}&cols=${cols}&rows=${rows}`;
    console.log('[WS] Connecting...');
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
      setError(null);
      reconnectDelayRef.current = RECONNECT_MIN;

      // Start ping interval
      pingTimerRef.current = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, PING_INTERVAL);
    };

    ws.onclose = (event) => {
      console.log('[WS] Disconnected, code:', event.code);
      setConnected(false);
      cleanup();

      if (event.code === 4001) {
        // Auth failed — don't reconnect
        authFailedRef.current = true;
        setError('Authentication failed');
        setToken(null);
        localStorage.removeItem('cli-online-token');
        return;
      }

      if (event.code === 4002) {
        // Replaced by new connection — don't reconnect
        return;
      }

      // Exponential backoff reconnect
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(delay * 2, RECONNECT_MAX);
      console.log(`[WS] Reconnecting in ${delay}ms...`);
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
            setSessionResumed(msg.resumed);
            break;
          case 'error':
            setError(msg.error);
            break;
          case 'pong':
            // Heartbeat OK
            break;
        }
      } catch {
        // Ignore parse errors
      }
    };

    wsRef.current = ws;
  }, [terminalRef, setConnected, setSessionResumed, setError, setToken, cleanup]);

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

  // Connect when token is available
  useEffect(() => {
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
  }, [token, connect, cleanup]);

  return { sendInput, sendResize };
}
