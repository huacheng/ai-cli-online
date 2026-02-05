export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'pending' | 'running' | 'completed' | 'error';
}

export interface WSMessage {
  type: 'send_message' | 'set_working_dir' | 'get_history' | 'ping' | 'clear_conversation';
  payload?: unknown;
}

export interface WSResponse {
  type: 'message' | 'history' | 'working_dir' | 'error' | 'pong' | 'status' | 'cleared';
  payload: unknown;
}
