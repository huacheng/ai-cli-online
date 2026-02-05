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
  createdAt: number;
  updatedAt: number;
}

export interface WSMessage {
  type: 'send_message' | 'set_working_dir' | 'get_history' | 'ping';
  payload?: unknown;
}

export interface WSResponse {
  type: 'message' | 'history' | 'working_dir' | 'error' | 'pong' | 'status';
  payload: unknown;
}

export interface ClaudeCodeResult {
  success: boolean;
  output: string;
  error?: string;
}
