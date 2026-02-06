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

// Server session info from REST API
export interface ServerSession {
  sessionId: string;
  sessionName: string;
  createdAt: number;
  active: boolean;
}

// Re-export shared protocol types
export type { ClientMessage, ServerMessage } from 'cli-online-shared';
