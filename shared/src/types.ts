/**
 * Binary protocol type prefixes for hot-path WebSocket messages.
 * Format: [1-byte type prefix][raw UTF-8 payload]
 */
export const BIN_TYPE_OUTPUT = 0x01;
export const BIN_TYPE_INPUT = 0x02;
export const BIN_TYPE_SCROLLBACK = 0x03;
export const BIN_TYPE_SCROLLBACK_CONTENT = 0x04;
export const BIN_TYPE_FILE_CHUNK = 0x05;

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
  | { type: 'capture-scrollback' }
  | { type: 'stream-file'; path: string }
  | { type: 'cancel-stream' };

// Server → Client messages
export type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'scrollback'; data: string }
  | { type: 'scrollback-content'; data: string }
  | { type: 'connected'; resumed: boolean }
  | { type: 'error'; error: string }
  | { type: 'pong'; timestamp: number }
  | { type: 'file-stream-start'; size: number; mtime: number }
  | { type: 'file-stream-end' }
  | { type: 'file-stream-error'; error: string };
