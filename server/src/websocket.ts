import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { storage } from './storage.js';
import { executeClaudeCode } from './claude.js';
import type { WSMessage, WSResponse, Message } from './types.js';

/**
 * Strip ANSI escape codes for streaming display
 */
function stripAnsiForStream(str: string): string {
  return str
    // Standard ANSI escape sequences (CSI) - comprehensive pattern
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')
    // Alternative CSI format with any parameters
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[[<>=?]?[0-9;]*[A-Za-z]/g, '')
    // OSC (Operating System Command) sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    // Single character escape sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B[@-Z\\-_]/g, '')
    // Private mode sequences (like CSI ? Pm h/l)
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[\?[0-9;]*[a-z]/gi, '')
    // DEC private modes
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[[0-9;]*[hHlL]/g, '')
    // Bracketed paste mode and similar
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\[[<>]?[0-9;]*[a-z]/gi, '')
    // Orphaned escape sequences parameters (like "9;4;0;")
    .replace(/(?:^|[\n\r])?\d+(?:;\d+)*;(?=[\n\r]|$)/g, '')
    // Incomplete escape sequences at end of string (like "[<u")
    .replace(/\[<[a-z]?$/gi, '')
    .replace(/\[\??\d*;?\d*[a-z]?$/gi, '')
    // Bell character
    // eslint-disable-next-line no-control-regex
    .replace(/\x07/g, '')
    // Carriage return (for progress indicators)
    .replace(/\r(?!\n)/g, '')
    // Other control characters except newline and tab
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

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

let connectionCounter = 0;

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

    const connId = ++connectionCounter;
    console.log(`[WS] Client connected (conn #${connId}), total connections: ${wss.clients.size}`);

    // Store connection ID on the ws object
    (ws as WebSocket & { connId: number }).connId = connId;

    // Monitor connection state
    ws.on('close', (code, reason) => {
      console.log(`[WS #${connId}] Connection closed, code: ${code}, reason: ${reason}`);
    });
    ws.on('error', (err) => {
      console.error(`[WS #${connId}] Error:`, err);
    });

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
  const connId = (ws as WebSocket & { connId: number }).connId || 0;
  if (ws.readyState === WebSocket.OPEN) {
    const data = JSON.stringify(response);
    ws.send(data);
    if (response.type === 'stream' || response.type === 'message') {
      console.log(`[WS #${connId}] Sent ${response.type}, size: ${data.length}`);
    }
  } else {
    console.log(`[WS #${connId}] Cannot send ${response.type}, readyState: ${ws.readyState}`);
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

    case 'clear_conversation':
      handleClearConversation(ws);
      break;

    default:
      sendError(ws, `Unknown message type: ${message.type}`);
  }
}

function handleClearConversation(ws: WebSocket): void {
  const conversation = storage.getCurrentConversation();
  if (conversation) {
    // Delete current conversation and create a new one
    const workingDir = storage.getConversationWorkingDir(conversation.id);
    storage.deleteConversation(conversation.id);

    // Create a new conversation with the same working directory
    const newConversation = storage.createConversation(uuidv4());
    storage.updateConversationWorkingDir(newConversation.id, workingDir);

    console.log(`[WS] Cleared conversation, created new: ${newConversation.id}`);
  }

  // Notify client
  send(ws, { type: 'cleared', payload: {} });
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
  let isNewSession = false;

  if (!conversation) {
    const id = uuidv4();
    conversation = storage.createConversation(id);
    console.log(`[WS] Created new conversation: ${id}`);
  }

  // Check if we need to create a new Claude session
  let claudeSessionId = storage.getClaudeSessionId(conversation.id);
  if (!claudeSessionId) {
    // Generate new Claude session ID for this conversation
    claudeSessionId = uuidv4();
    storage.setClaudeSessionId(conversation.id, claudeSessionId);
    isNewSession = true;
    console.log(`[WS] Created new Claude session: ${claudeSessionId}`);
  } else {
    console.log(`[WS] Resuming Claude session: ${claudeSessionId}`);
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

  // Send assistant message placeholder to client first
  send(ws, {
    type: 'message',
    payload: assistantMessage,
  });

  // Execute Claude Code using conversation-specific workingDir
  const workingDir = storage.getConversationWorkingDir(conversation.id);
  console.log(`[WS] Executing Claude Code in ${workingDir}: ${content}`);

  // Track streamed content for real-time updates
  let streamedContent = '';

  try {
    const result = await executeClaudeCode({
      workingDir,
      message: content,
      sessionId: claudeSessionId,
      isNewSession,
      // Real-time streaming callback
      onData: (chunk) => {
        // Strip ANSI codes from chunk for display
        const cleanChunk = stripAnsiForStream(chunk);
        console.log(`[Stream] Raw chunk length: ${chunk.length}, Clean chunk length: ${cleanChunk.length}`);
        if (cleanChunk.trim()) {
          streamedContent += cleanChunk;
          console.log(`[Stream] Sending stream update, total length: ${streamedContent.length}`);
          // Send stream update to client
          send(ws, {
            type: 'stream',
            payload: {
              messageId: assistantMessage.id,
              chunk: cleanChunk,
              content: streamedContent,
            },
          });
        }
      },
    });

    // Small delay to ensure stream messages are received by client
    await new Promise(resolve => setTimeout(resolve, 100));

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
