// Shared file entry type (used by server file listing and web file browser)
export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

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
