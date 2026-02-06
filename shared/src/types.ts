// Client → Server messages
export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' }
  | { type: 'capture-scrollback' };

// Server → Client messages
export type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'scrollback'; data: string }
  | { type: 'scrollback-content'; data: string }
  | { type: 'connected'; resumed: boolean }
  | { type: 'error'; error: string }
  | { type: 'pong'; timestamp: number };
