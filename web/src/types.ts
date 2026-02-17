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
export interface PanelState {
  chatOpen: boolean;
  planOpen: boolean;
  gitHistoryOpen: boolean;
}

export interface TerminalInstance {
  id: string;
  connected: boolean;
  sessionResumed: boolean;
  error: string | null;
  panels: PanelState;
  startCwd?: string;
}

// Server session info from REST API
export interface ServerSession {
  sessionId: string;
  sessionName: string;
  createdAt: number;
  active: boolean;
}

// Tab types for multi-terminal grouping
export type TabStatus = 'open' | 'closed';

export interface TabState {
  id: string;               // e.g., "tab1", "tab2"
  name: string;             // user-visible label
  status: TabStatus;
  terminalIds: string[];    // ordered terminal IDs owned by this tab
  layout: LayoutNode | null;
  createdAt: number;        // Date.now() at creation
  panelStates?: Record<string, PanelState>;  // per-terminal panel state (persisted across refresh)
}

export interface PersistedTabsState {
  version: 2;
  activeTabId: string;
  nextId: number;           // global terminal counter
  nextSplitId: number;      // global split counter
  nextTabId: number;        // global tab counter
  tabs: TabState[];         // open + closed tabs
}

// Re-export shared protocol types
export type { ClientMessage, ServerMessage } from 'ai-cli-online-shared';
