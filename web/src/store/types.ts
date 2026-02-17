import type {
  TerminalInstance,
  LayoutNode,
  SplitDirection,
  ServerSession,
  TabState,
} from '../types';

// ---------------------------------------------------------------------------
// Settings slice — fully independent (no persistence side-effects)
// ---------------------------------------------------------------------------

export interface SettingsSlice {
  fontSize: number;
  setFontSize: (size: number) => void;

  latency: number | null;
  setLatency: (latency: number | null) => void;

  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

  sidebarOpen: boolean;
  toggleSidebar: () => void;

  serverSessions: ServerSession[];
  fetchSessions: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Core slice — auth, tabs, terminals, layout, persistence-coupled actions
// ---------------------------------------------------------------------------

export interface CoreSlice {
  token: string | null;
  setToken: (token: string | null) => void;

  /** True while async server restore is in progress */
  tabsLoading: boolean;

  terminalsMap: Record<string, TerminalInstance>;

  /** Derived from active tab — ordered terminal IDs for the visible tab */
  terminalIds: string[];
  /** Derived from active tab — layout tree for the visible tab */
  layout: LayoutNode | null;

  nextId: number;
  nextSplitId: number;

  // Tab system
  tabs: TabState[];
  activeTabId: string;
  nextTabId: number;

  // Tab actions
  addTab: (name?: string) => string;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  reopenTab: (tabId: string) => void;
  deleteTab: (tabId: string) => Promise<void>;
  renameTab: (tabId: string, name: string) => void;

  // Terminal actions (scoped to active tab)
  addTerminal: (direction?: SplitDirection, customSessionId?: string) => string;
  splitTerminal: (terminalId: string, direction: SplitDirection, startCwd?: string) => string;
  removeTerminal: (id: string) => void;
  disconnectTerminal: (id: string) => void;
  reconnectTerminal: (id: string) => void;

  setTerminalConnected: (id: string, connected: boolean) => void;
  setTerminalResumed: (id: string, resumed: boolean) => void;
  setTerminalError: (id: string, error: string | null) => void;
  toggleChat: (id: string) => void;
  togglePlan: (id: string) => void;
  toggleGitHistory: (id: string) => void;

  setSplitSizes: (splitId: string, sizes: number[]) => void;

  // Sidebar session management
  killServerSession: (sessionId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Combined store type
// ---------------------------------------------------------------------------

export type AppState = SettingsSlice & CoreSlice;

export type PersistableFields = Pick<
  AppState,
  'tabs' | 'activeTabId' | 'nextId' | 'nextSplitId' | 'nextTabId'
>;
