import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { storage } from './storage.js';
import { executeClaudeCode } from './claude.js';
import type { WSMessage, WSResponse, Message } from './types.js';

/**
 * Detect working directory change from Claude output
 * Looks for patterns like:
 * - "Shell cwd was reset to /path/to/dir"
 * - "已切换到 /path/to/dir 目录"
 * - "已切换到 `/path/to/dir` 目录"
 */
function detectWorkingDirChange(output: string): string | null {
  // Pattern 1: Shell cwd was reset to /path
  const shellCwdMatch = output.match(/Shell cwd was reset to ([^\s\n]+)/);
  if (shellCwdMatch) {
    return shellCwdMatch[1];
  }

  // Pattern 2: 已切换到 /path 目录 or 已切换到 `/path` 目录
  const chineseMatch = output.match(/已切换到\s*[`"]?([^`"\s\n]+)[`"]?\s*目录/);
  if (chineseMatch) {
    return chineseMatch[1];
  }

  // Pattern 3: Changed directory to /path
  const changedMatch = output.match(/[Cc]hanged (?:directory|dir) to ([^\s\n]+)/);
  if (changedMatch) {
    return changedMatch[1];
  }

  // Pattern 4: cd /path (direct cd command output)
  const cdMatch = output.match(/^cd\s+([^\s\n]+)/m);
  if (cdMatch) {
    return cdMatch[1];
  }

  return null;
}

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
  // Use conversation-specific workingDir, fallback to global
  const workingDir = conversation
    ? storage.getConversationWorkingDir(conversation.id)
    : storage.getWorkingDir();

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

  // Execute Claude Code using conversation-specific workingDir
  const workingDir = storage.getConversationWorkingDir(conversation.id);
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

    // Detect working directory change from Claude output
    const newWorkingDir = detectWorkingDirChange(result.output);
    if (newWorkingDir && newWorkingDir !== workingDir) {
      console.log(`[WS] Working directory changed: ${workingDir} -> ${newWorkingDir}`);
      storage.updateConversationWorkingDir(conversation.id, newWorkingDir);

      // Notify client of working directory change
      send(ws, {
        type: 'working_dir',
        payload: { workingDir: newWorkingDir },
      });
    }

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
