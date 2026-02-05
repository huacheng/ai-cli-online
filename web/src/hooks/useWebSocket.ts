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
  const handleMessageRef = useRef<((response: WSResponse) => void) | null>(null);

  const {
    setConnected,
    setWorkingDir,
    setMessages,
    addMessage,
    updateMessage,
    clearMessages,
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
    // 关闭任何现有连接，确保只有一个活跃连接
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        console.log('[WS] Already connected, skipping');
        return;
      }
      if (wsRef.current.readyState === WebSocket.CONNECTING) {
        console.log('[WS] Connection in progress, skipping');
        return;
      }
      // 关闭旧连接
      console.log('[WS] Closing stale connection');
      wsRef.current.close();
      wsRef.current = null;
    }

    const currentToken = useStore.getState().token;
    if (!currentToken) {
      console.log('[WS] No token, waiting for authentication');
      return;
    }

    const wsUrl = `${WS_BASE}?token=${encodeURIComponent(currentToken)}`;
    console.log('[WS] Connecting to:', wsUrl);
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
        // 详细日志：显示消息类型和关键信息
        if (response.type === 'stream') {
          const p = response.payload as { messageId: string; content: string };
          console.log('[WS] 📥 STREAM received, msgId:', p.messageId, 'len:', p.content?.length);
        } else if (response.type === 'message') {
          const p = response.payload as { id: string; role: string; status?: string };
          console.log('[WS] 📥 MESSAGE received, id:', p.id, 'role:', p.role, 'status:', p.status);
        } else {
          console.log('[WS] 📥 Received:', response.type);
        }

        // Use ref to always get the latest handleMessage
        if (handleMessageRef.current) {
          handleMessageRef.current(response);
        } else {
          console.error('[WS] ❌ handleMessageRef.current is null!');
        }
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

        case 'stream': {
          // Real-time streaming update
          const streamPayload = response.payload as {
            messageId: string;
            chunk: string;
            content: string;
          };
          // Check if message exists in store
          const currentMessages = useStore.getState().messages;
          const targetMsg = currentMessages.find(m => m.id === streamPayload.messageId);
          console.log('[WS] 🔄 Processing stream:', {
            msgId: streamPayload.messageId,
            contentLen: streamPayload.content?.length,
            found: !!targetMsg,
            totalMsgs: currentMessages.length,
            msgIds: currentMessages.map(m => m.id.slice(0, 8)),
          });

          if (!targetMsg) {
            console.warn('[WS] ⚠️ Target message not found! Stream will be ignored.');
          }

          // Update message content with streamed data
          updateMessage(streamPayload.messageId, {
            content: streamPayload.content,
          });

          // Verify update
          const afterUpdate = useStore.getState().messages.find(m => m.id === streamPayload.messageId);
          console.log('[WS] ✅ After update, content length:', afterUpdate?.content?.length);
          break;
        }

        case 'cleared':
          // Conversation cleared
          clearMessages();
          break;

        default:
          console.log('[WS] Unknown message type:', response.type);
      }
    },
    [setMessages, setWorkingDir, addMessage, updateMessage, clearMessages, setIsLoading, setError]
  );

  // Keep ref updated with latest handleMessage (sync, not in useEffect)
  handleMessageRef.current = handleMessage;

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

  const clearConversation = useCallback(() => {
    send({ type: 'clear_conversation' });
  }, [send]);

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
    clearConversation,
  };
}
