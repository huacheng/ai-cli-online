// Layout tree types for split pane support
export type SplitDirection = 'horizontal' | 'vertical';

export interface LeafNode {
  type: 'leaf';
  terminalId: string;
}

export interface SplitNode {
  id: string;
  type: 'split';
  direction: SplitDirection;
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = LeafNode | SplitNode;

// Terminal instance for connection state tracking
export interface TerminalInstance {
  id: string;
  connected: boolean;
  sessionResumed: boolean;
  error: string | null;
}

// Client → Server messages
export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'ping' };

// Server → Client messages
export type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'scrollback'; data: string }
  | { type: 'connected'; resumed: boolean }
  | { type: 'error'; error: string }
  | { type: 'pong'; timestamp: number };
