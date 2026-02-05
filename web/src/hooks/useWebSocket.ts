import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { WSMessage, WSResponse, Message } from '../types';

// Auto-detect protocol based on page protocol
const WS_BASE = import.meta.env.DEV
  ? 'wss://localhost:3001/ws'  // Use wss for development too (self-signed cert)
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

const RECONNECT_DELAY = 3000;

// Get token from URL params or localStorage
function getToken(): string | null {
  // First check URL params
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    // Save to localStorage for future use
    localStorage.setItem('cli-online-token', urlToken);
    // Remove token from URL for security
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.delete('token');
    window.history.replaceState({}, '', newUrl.toString());
    return urlToken;
  }

  // Then check localStorage
  return localStorage.getItem('cli-online-token');
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const {
    setConnected,
    setWorkingDir,
    setMessages,
    addMessage,
    updateMessage,
    setIsLoading,
    setError,
    token,
    setToken,
  } = useStore();

  // Initialize token on mount
  useEffect(() => {
    const savedToken = getToken();
    if (savedToken) {
      setToken(savedToken);
    }
  }, [setToken]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    const currentToken = useStore.getState().token;
    if (!currentToken) {
      console.log('[WS] No token, waiting for authentication');
      return;
    }

    const wsUrl = `${WS_BASE}?token=${encodeURIComponent(currentToken)}`;
    console.log('[WS] Connecting...');
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
      setError(null);

      // Request initial state
      ws.send(JSON.stringify({ type: 'get_history' }));
    };

    ws.onclose = (event) => {
      console.log('[WS] Disconnected, code:', event.code);
      setConnected(false);
      wsRef.current = null;

      // If unauthorized, clear token
      if (event.code === 4001) {
        setError('认证失败，请检查 Token');
        setToken(null);
        localStorage.removeItem('cli-online-token');
        return;
      }

      // Auto reconnect
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = window.setTimeout(() => {
        console.log('[WS] Attempting to reconnect...');
        connect();
      }, RECONNECT_DELAY);
    };

    ws.onerror = (event) => {
      console.error('[WS] Error:', event);
      setError('WebSocket connection error');
    };

    ws.onmessage = (event) => {
      try {
        const response: WSResponse = JSON.parse(event.data);
        handleMessage(response);
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    };

    wsRef.current = ws;
  }, [setConnected, setError, setToken]);

  const handleMessage = useCallback(
    (response: WSResponse) => {
      switch (response.type) {
        case 'history': {
          const payload = response.payload as {
            messages: Message[];
            workingDir: string;
          };
          setMessages(payload.messages || []);
          setWorkingDir(payload.workingDir || '');
          break;
        }

        case 'message': {
          const message = response.payload as Message;
          // Check if message already exists (update) or is new (add)
          const existingMessages = useStore.getState().messages;
          const exists = existingMessages.some((m) => m.id === message.id);
          if (exists) {
            updateMessage(message.id, message);
          } else {
            addMessage(message);
          }

          // Clear loading state if assistant message is completed
          if (
            message.role === 'assistant' &&
            (message.status === 'completed' || message.status === 'error')
          ) {
            setIsLoading(false);
          }
          break;
        }

        case 'status': {
          const payload = response.payload as {
            messageId: string;
            status: string;
          };
          updateMessage(payload.messageId, {
            status: payload.status as Message['status'],
          });
          if (payload.status === 'running') {
            setIsLoading(true);
          }
          break;
        }

        case 'working_dir': {
          const payload = response.payload as { workingDir: string };
          setWorkingDir(payload.workingDir);
          break;
        }

        case 'error': {
          const payload = response.payload as { error: string };
          setError(payload.error);
          setIsLoading(false);
          break;
        }

        case 'pong':
          // Heartbeat response, ignore
          break;

        default:
          console.log('[WS] Unknown message type:', response.type);
      }
    },
    [setMessages, setWorkingDir, addMessage, updateMessage, setIsLoading, setError]
  );

  const send = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.error('[WS] Cannot send, not connected');
    }
  }, []);

  const sendMessage = useCallback(
    (content: string) => {
      setIsLoading(true);
      send({ type: 'send_message', payload: { content } });
    },
    [send, setIsLoading]
  );

  const setWorkingDirectory = useCallback(
    (dir: string) => {
      send({ type: 'set_working_dir', payload: { dir } });
    },
    [send]
  );

  // Connect when token is available
  useEffect(() => {
    if (token) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [token, connect]);

  return {
    sendMessage,
    setWorkingDirectory,
  };
}
