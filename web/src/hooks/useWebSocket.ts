import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { WSMessage, WSResponse, Message } from '../types';

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001/ws'
  : `ws://${window.location.host}/ws`;

const RECONNECT_DELAY = 3000;

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
  } = useStore();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    console.log('[WS] Connecting to', WS_URL);
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[WS] Connected');
      setConnected(true);
      setError(null);

      // Request initial state
      ws.send(JSON.stringify({ type: 'get_history' }));
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setConnected(false);
      wsRef.current = null;

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
  }, [setConnected, setError]);

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

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    sendMessage,
    setWorkingDirectory,
  };
}
