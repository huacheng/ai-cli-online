// Message types for WebSocket communication

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'pending' | 'running' | 'completed' | 'error';
}

export interface Conversation {
  id: string;
  workingDir: string;
  messages: Message[];
  claudeSessionId?: string; // Claude Code session ID for --resume
  createdAt: number;
  updatedAt: number;
}

export interface WSMessage {
  type: 'send_message' | 'set_working_dir' | 'get_history' | 'ping' | 'clear_conversation';
  payload?: unknown;
}

export interface WSResponse {
  type: 'message' | 'history' | 'working_dir' | 'error' | 'pong' | 'status' | 'stream' | 'cleared';
  payload: unknown;
}

export interface ClaudeCodeResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string; // Claude Code session ID extracted from output
}
