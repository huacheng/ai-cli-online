import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { storage } from './storage.js';
import { executeClaudeCode } from './claude.js';
import type { WSMessage, WSResponse, Message } from './types.js';

export function setupWebSocket(wss: WebSocketServer, authToken: string): void {
  wss.on('connection', (ws, req) => {
    // Simple token authentication via query parameter
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (authToken && token !== authToken) {
      console.log('[WS] Unauthorized connection attempt');
      ws.close(4001, 'Unauthorized');
      return;
    }

    console.log('[WS] Client connected');

    // Send initial state
    sendState(ws);

    ws.on('message', async (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (err) {
        console.error('[WS] Error handling message:', err);
        sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });

    ws.on('error', (err) => {
      console.error('[WS] WebSocket error:', err);
    });
  });
}

function send(ws: WebSocket, response: WSResponse): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
  }
}

function sendError(ws: WebSocket, error: string): void {
  send(ws, { type: 'error', payload: { error } });
}

function sendState(ws: WebSocket): void {
  const conversation = storage.getCurrentConversation();
  const workingDir = storage.getWorkingDir();

  send(ws, {
    type: 'history',
    payload: {
      conversationId: conversation?.id || null,
      messages: conversation?.messages || [],
      workingDir,
    },
  });
}

async function handleMessage(ws: WebSocket, message: WSMessage): Promise<void> {
  switch (message.type) {
    case 'ping':
      send(ws, { type: 'pong', payload: { timestamp: Date.now() } });
      break;

    case 'get_history':
      sendState(ws);
      break;

    case 'set_working_dir':
      handleSetWorkingDir(ws, message.payload as { dir: string });
      break;

    case 'send_message':
      await handleSendMessage(ws, message.payload as { content: string });
      break;

    default:
      sendError(ws, `Unknown message type: ${message.type}`);
  }
}

function handleSetWorkingDir(ws: WebSocket, payload: { dir: string }): void {
  const { dir } = payload;

  if (!dir) {
    sendError(ws, 'Directory path is required');
    return;
  }

  storage.setWorkingDir(dir);
  console.log(`[WS] Working directory set to: ${dir}`);

  send(ws, {
    type: 'working_dir',
    payload: { workingDir: dir },
  });
}

async function handleSendMessage(ws: WebSocket, payload: { content: string }): Promise<void> {
  const { content } = payload;

  if (!content || !content.trim()) {
    sendError(ws, 'Message content is required');
    return;
  }

  // Get or create conversation
  let conversation = storage.getCurrentConversation();
  if (!conversation) {
    const id = uuidv4();
    conversation = storage.createConversation(id);
    console.log(`[WS] Created new conversation: ${id}`);
  }

  // Add user message
  const userMessage: Message = {
    id: uuidv4(),
    role: 'user',
    content: content.trim(),
    timestamp: Date.now(),
  };
  storage.addMessage(conversation.id, userMessage);

  // Send user message back to client
  send(ws, {
    type: 'message',
    payload: userMessage,
  });

  // Create assistant message placeholder
  const assistantMessage: Message = {
    id: uuidv4(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    status: 'running',
  };
  storage.addMessage(conversation.id, assistantMessage);

  // Send status update
  send(ws, {
    type: 'status',
    payload: { messageId: assistantMessage.id, status: 'running' },
  });

  // Execute Claude Code
  const workingDir = storage.getWorkingDir();
  console.log(`[WS] Executing Claude Code in ${workingDir}: ${content}`);

  try {
    const result = await executeClaudeCode({
      workingDir,
      message: content,
    });

    // Update assistant message with result
    const responseContent = result.success
      ? result.output
      : `Error: ${result.error}\n\n${result.output}`;

    storage.updateMessage(conversation.id, assistantMessage.id, {
      content: responseContent,
      status: result.success ? 'completed' : 'error',
    });

    // Send completed message to client
    send(ws, {
      type: 'message',
      payload: {
        ...assistantMessage,
        content: responseContent,
        status: result.success ? 'completed' : 'error',
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    storage.updateMessage(conversation.id, assistantMessage.id, {
      content: `Error: ${errorMessage}`,
      status: 'error',
    });

    send(ws, {
      type: 'message',
      payload: {
        ...assistantMessage,
        content: `Error: ${errorMessage}`,
        status: 'error',
      },
    });
  }
}
