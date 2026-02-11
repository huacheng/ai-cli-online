import { create } from 'zustand';
import type {
  TerminalInstance,
  PanelState,
  LayoutNode,
  SplitDirection,
  ServerSession,
  TabState,
  PersistedTabsState,
} from './types';
import { API_BASE, authHeaders } from './api/client';
import { fetchFontSize, saveFontSize } from './api/settings';
import { fetchTabsLayout, saveTabsLayout, saveTabsLayoutBeacon } from './api/tabs';

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const TABS_KEY = 'ai-cli-online-tabs';

// Legacy keys (migration only)
const LEGACY_LAYOUT_KEY = 'ai-cli-online-layout';
const LEGACY_SESSION_NAMES_KEY = 'ai-cli-online-session-names';

// Legacy persistence type (migration only)
interface LegacyPersistedLayout {
  terminalIds: string[];
  layout: LayoutNode | null;
  nextId: number;
  nextSplitId: number;
}

// ---------------------------------------------------------------------------
// Tree helpers (unchanged)
// ---------------------------------------------------------------------------

function removeLeafFromTree(node: LayoutNode, terminalId: string): LayoutNode | null {
  if (node.type === 'leaf') {
    return node.terminalId === terminalId ? null : node;
  }

  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];

  for (let i = 0; i < node.children.length; i++) {
    const result = removeLeafFromTree(node.children[i], terminalId);
    if (result !== null) {
      newChildren.push(result);
      newSizes.push(node.sizes[i]);
    }
  }

  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];

  // Normalize sizes
  const total = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map((s) => (s / total) * 100);

  return { ...node, children: newChildren, sizes: normalizedSizes };
}

function splitLeafInTree(
  node: LayoutNode,
  terminalId: string,
  direction: SplitDirection,
  newLeaf: LayoutNode,
  splitId: string,
): LayoutNode {
  if (node.type === 'leaf') {
    if (node.terminalId === terminalId) {
      return {
        id: splitId,
        type: 'split',
        direction,
        children: [node, newLeaf],
        sizes: [50, 50],
      };
    }
    return node;
  }

  return {
    ...node,
    children: node.children.map((child) =>
      splitLeafInTree(child, terminalId, direction, newLeaf, splitId),
    ),
  };
}

function updateSplitSizes(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (node.type === 'leaf') return node;

  if (node.id === splitId) {
    return { ...node, sizes };
  }

  return {
    ...node,
    children: node.children.map((child) => updateSplitSizes(child, splitId, sizes)),
  };
}

// ---------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------

function getActiveTab(state: { tabs: TabState[]; activeTabId: string }): TabState | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

function updateTab(
  tabs: TabState[],
  tabId: string,
  updater: (tab: TabState) => TabState,
): TabState[] {
  return tabs.map((t) => (t.id === tabId ? updater(t) : t));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type PersistableFields = Pick<
  AppState,
  'tabs' | 'activeTabId' | 'nextId' | 'nextSplitId' | 'nextTabId'
>;

function persistTabs(state: PersistableFields): void {
  const data: PersistedTabsState = {
    version: 2,
    activeTabId: state.activeTabId,
    nextId: state.nextId,
    nextSplitId: state.nextSplitId,
    nextTabId: state.nextTabId,
    tabs: state.tabs,
  };
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(data));
  } catch {
    /* storage full */
  }
  persistTabsToServer(data);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let fontSizeTimer: ReturnType<typeof setTimeout> | null = null;
let serverPersistTimer: ReturnType<typeof setTimeout> | null = null;

/** Last layout data pending for sendBeacon on page close */
let pendingServerLayout: PersistedTabsState | null = null;

/** Save tabs layout to server with 2s debounce */
function persistTabsToServer(data: PersistedTabsState): void {
  pendingServerLayout = data;
  if (serverPersistTimer) clearTimeout(serverPersistTimer);
  serverPersistTimer = setTimeout(() => {
    serverPersistTimer = null;
    pendingServerLayout = null;
    const token = useStore.getState().token;
    if (token) {
      saveTabsLayout(token, data);
    }
  }, 2000);
}

/** Debounced persistTabs for high-frequency calls (e.g., drag-resize) */
function persistTabsDebounced(state: PersistableFields): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistTabs(state);
  }, 500);
}

/**
 * Load persisted tabs (v2) or migrate from v1 layout.
 *
 * 1. Try `ai-cli-online-tabs` with version: 2 -> return if found
 * 2. Try old `ai-cli-online-layout` -> wrap into single "Default" tab
 * 3. Read old `ai-cli-online-session-names` -> use first session name as tab name
 * 4. Write migrated v2, delete old keys
 * 5. Return null if neither exists
 */
function loadTabs(): PersistedTabsState | null {
  // 1. Try v2 format
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 2) return parsed as PersistedTabsState;
    }
  } catch {
    /* corrupt data */
  }

  // 2. Migrate from v1 (old layout + session names)
  try {
    const raw = localStorage.getItem(LEGACY_LAYOUT_KEY);
    if (raw) {
      const legacy: LegacyPersistedLayout = JSON.parse(raw);

      // 3. Read old session names for tab label
      let tabName = 'Default';
      try {
        const namesRaw = localStorage.getItem(LEGACY_SESSION_NAMES_KEY);
        if (namesRaw) {
          const names: Record<string, string> = JSON.parse(namesRaw);
          const first = Object.values(names)[0];
          if (first) tabName = first;
        }
      } catch {
        /* ignore */
      }

      const tab: TabState = {
        id: 'tab1',
        name: tabName,
        status: 'open',
        terminalIds: legacy.terminalIds,
        layout: legacy.layout,
        createdAt: Date.now(),
      };

      const migrated: PersistedTabsState = {
        version: 2,
        activeTabId: 'tab1',
        nextId: legacy.nextId,
        nextSplitId: legacy.nextSplitId,
        nextTabId: 2,
        tabs: [tab],
      };

      // 4. Persist migrated v2, delete legacy keys
      try {
        localStorage.setItem(TABS_KEY, JSON.stringify(migrated));
      } catch {
        /* storage full */
      }
      localStorage.removeItem(LEGACY_LAYOUT_KEY);
      localStorage.removeItem(LEGACY_SESSION_NAMES_KEY);

      return migrated;
    }
  } catch {
    /* corrupt data */
  }

  return null;
}

function toPersistable(state: AppState): PersistableFields {
  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    nextId: state.nextId,
    nextSplitId: state.nextSplitId,
    nextTabId: state.nextTabId,
  };
}

// ---------------------------------------------------------------------------
// tmux reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile a persisted layout with live tmux sessions.
 * Removes terminals whose tmux sessions no longer exist, collapses empty tabs.
 * Returns null if no surviving tabs remain.
 */
function reconcileWithTmux(
  saved: PersistedTabsState,
  liveSessions: ServerSession[],
): PersistedTabsState | null {
  const liveIds = new Set(liveSessions.map((s) => s.sessionId));

  const reconciledTabs: TabState[] = [];
  for (const tab of saved.tabs) {
    if (tab.status !== 'open') {
      // Closed tabs: drop terminals that are dead, keep tab if any survive
      const aliveIds = tab.terminalIds.filter((id) => liveIds.has(id));
      if (aliveIds.length > 0) {
        let layout = tab.layout;
        for (const id of tab.terminalIds) {
          if (!liveIds.has(id) && layout) {
            layout = removeLeafFromTree(layout, id);
          }
        }
        reconciledTabs.push({ ...tab, terminalIds: aliveIds, layout });
      }
      // If no alive terminals, drop the closed tab entirely
      continue;
    }

    // Open tab: filter dead terminals
    const aliveIds = tab.terminalIds.filter((id) => liveIds.has(id));
    if (aliveIds.length === 0) {
      // All terminals dead — drop tab
      continue;
    }

    let layout = tab.layout;
    for (const id of tab.terminalIds) {
      if (!liveIds.has(id) && layout) {
        layout = removeLeafFromTree(layout, id);
      }
    }
    reconciledTabs.push({ ...tab, terminalIds: aliveIds, layout });
  }

  if (reconciledTabs.filter((t) => t.status === 'open').length === 0) {
    return null;
  }

  // Fix activeTabId if it was removed
  let activeTabId = saved.activeTabId;
  const activeExists = reconciledTabs.find(
    (t) => t.id === activeTabId && t.status === 'open',
  );
  if (!activeExists) {
    const firstOpen = reconciledTabs.find((t) => t.status === 'open');
    activeTabId = firstOpen?.id || '';
  }

  return {
    ...saved,
    activeTabId,
    tabs: reconciledTabs,
  };
}

// ---------------------------------------------------------------------------
// beforeunload — flush pending layout via sendBeacon
// ---------------------------------------------------------------------------

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    const token = useStore?.getState?.()?.token;
    if (!token) return;
    // If there's a pending debounced save, flush it immediately via sendBeacon
    if (pendingServerLayout) {
      if (serverPersistTimer) {
        clearTimeout(serverPersistTimer);
        serverPersistTimer = null;
      }
      saveTabsLayoutBeacon(token, pendingServerLayout);
      pendingServerLayout = null;
    } else {
      // No pending save — send current state as a safety net
      const state = useStore.getState();
      if (state.tabs.length > 0) {
        saveTabsLayoutBeacon(token, toPersistable(state) as PersistedTabsState);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Shared terminal removal helper (used by removeTerminal & killServerSession)
// ---------------------------------------------------------------------------

function removeTerminalFromState(
  state: AppState,
  terminalId: string,
): Partial<AppState> | null {
  const ownerTab = state.tabs.find((t) => t.terminalIds.includes(terminalId));

  if (!ownerTab) {
    // Not in any tab — just remove from terminalsMap
    const { [terminalId]: _, ...rest } = state.terminalsMap;
    return { terminalsMap: rest };
  }

  const newTabTerminalIds = ownerTab.terminalIds.filter((tid) => tid !== terminalId);
  const newTabLayout = ownerTab.layout ? removeLeafFromTree(ownerTab.layout, terminalId) : null;
  const newTabs = updateTab(state.tabs, ownerTab.id, (t) => ({
    ...t,
    terminalIds: newTabTerminalIds,
    layout: newTabLayout,
  }));

  const { [terminalId]: _, ...restTerminals } = state.terminalsMap;

  const update: Partial<AppState> = {
    terminalsMap: restTerminals,
    tabs: newTabs,
  };

  // Update derived top-level fields only if this is the active tab
  if (ownerTab.id === state.activeTabId) {
    update.terminalIds = newTabTerminalIds;
    update.layout = newTabLayout;
  }

  return update;
}

// ---------------------------------------------------------------------------
// AppState interface
// ---------------------------------------------------------------------------

interface AppState {
  token: string | null;
  setToken: (token: string | null) => void;

  /** True while async server restore is in progress (prevents default tab creation) */
  tabsLoading: boolean;

  /** Terminal instances indexed by ID for O(1) lookup and isolated re-renders */
  terminalsMap: Record<string, TerminalInstance>;

  /** Derived from active tab — ordered terminal IDs for the visible tab */
  terminalIds: string[];
  /** Derived from active tab — layout tree for the visible tab */
  layout: LayoutNode | null;

  nextId: number;
  nextSplitId: number;

  // --- Tab system ---
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

  setTerminalConnected: (id: string, connected: boolean) => void;
  setTerminalResumed: (id: string, resumed: boolean) => void;
  setTerminalError: (id: string, error: string | null) => void;
  toggleChat: (id: string) => void;
  togglePlan: (id: string) => void;

  setSplitSizes: (splitId: string, sizes: number[]) => void;

  /** Global network latency (ms), measured via any active WebSocket ping/pong */
  latency: number | null;
  setLatency: (latency: number | null) => void;

  // Font size
  fontSize: number;
  setFontSize: (size: number) => void;

  // Theme
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;

  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  serverSessions: ServerSession[];
  fetchSessions: () => Promise<void>;
  killServerSession: (sessionId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>((set, get) => ({
  // --- Auth -------------------------------------------------------------------

  token: null,
  tabsLoading: false,

  setToken: (token) => {
    if (token) {
      try {
        localStorage.setItem('ai-cli-online-token', token);
      } catch {
        /* storage full */
      }

      // Load font size from server
      fetchFontSize(token).then((size) => {
        if (get().token === token) {
          set({ fontSize: size });
        }
      });

      // --- Phase 1: synchronous localStorage restore (fast render) ---
      const localSaved = loadTabs();
      if (localSaved && localSaved.tabs.length > 0) {
        const terminalsMap: Record<string, TerminalInstance> = {};
        for (const tab of localSaved.tabs) {
          if (tab.status === 'open') {
            for (const id of tab.terminalIds) {
              terminalsMap[id] = { id, connected: false, sessionResumed: false, error: null, panels: tab.panelStates?.[id] || { chatOpen: false, planOpen: false } };
            }
          }
        }
        const activeTab =
          localSaved.tabs.find((t) => t.id === localSaved.activeTabId && t.status === 'open') ||
          localSaved.tabs.find((t) => t.status === 'open');
        const activeTabId = activeTab?.id || '';

        set({
          token,
          tabsLoading: true,
          terminalsMap,
          tabs: localSaved.tabs,
          activeTabId,
          nextId: localSaved.nextId,
          nextSplitId: localSaved.nextSplitId,
          nextTabId: localSaved.nextTabId,
          terminalIds: activeTab?.terminalIds || [],
          layout: activeTab?.layout || null,
        });
      } else {
        set({
          token,
          tabsLoading: true,
          terminalsMap: {},
          tabs: [],
          activeTabId: '',
          nextId: 1,
          nextSplitId: 1,
          nextTabId: 1,
          terminalIds: [],
          layout: null,
        });
      }

      // --- Phase 2: async server restore + tmux reconciliation ---
      restoreFromServer(token, localSaved);
      return;
    }

    // Logout
    localStorage.removeItem('ai-cli-online-token');
    localStorage.removeItem(TABS_KEY);

    set({
      token,
      tabsLoading: false,
      terminalsMap: {},
      tabs: [],
      activeTabId: '',
      nextId: 1,
      nextSplitId: 1,
      nextTabId: 1,
      terminalIds: [],
      layout: null,
    });
  },

  // --- Global state -----------------------------------------------------------

  terminalsMap: {},
  terminalIds: [],
  layout: null,
  nextId: 1,
  nextSplitId: 1,

  // --- Tab state --------------------------------------------------------------

  tabs: [],
  activeTabId: '',
  nextTabId: 1,

  // --- Tab actions ------------------------------------------------------------

  addTab: (name) => {
    const state = get();
    const tabId = `tab${state.nextTabId}`;
    const termId = `t${state.nextId}`;
    const terminal: TerminalInstance = {
      id: termId,
      connected: false,
      sessionResumed: false,
      error: null,
      panels: { chatOpen: false, planOpen: false },
    };
    const leaf: LayoutNode = { type: 'leaf', terminalId: termId };
    const tab: TabState = {
      id: tabId,
      name: name || `Tab ${state.nextTabId}`,
      status: 'open',
      terminalIds: [termId],
      layout: leaf,
      createdAt: Date.now(),
    };

    set({
      tabs: [...state.tabs, tab],
      activeTabId: tabId,
      nextTabId: state.nextTabId + 1,
      nextId: state.nextId + 1,
      terminalsMap: { ...state.terminalsMap, [termId]: terminal },
      terminalIds: tab.terminalIds,
      layout: tab.layout,
    });
    persistTabs(toPersistable(get()));
    return tabId;
  },

  switchTab: (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.status !== 'open') return;

    set({
      activeTabId: tabId,
      terminalIds: tab.terminalIds,
      layout: tab.layout,
    });
    persistTabs(toPersistable(get()));
  },

  closeTab: (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.status !== 'open') return;

    // Enforce at least 1 open tab
    const openTabs = state.tabs.filter((t) => t.status === 'open');
    if (openTabs.length <= 1) return;

    // Remove this tab's terminals from terminalsMap
    const newTerminalsMap = { ...state.terminalsMap };
    for (const tid of tab.terminalIds) {
      delete newTerminalsMap[tid];
    }

    // Mark as closed (preserve layout + terminalIds in TabState for reopen)
    const newTabs = updateTab(state.tabs, tabId, (t) => ({
      ...t,
      status: 'closed' as const,
    }));

    // If closing active tab, switch to nearest open tab
    let newActiveTabId = state.activeTabId;
    let newTerminalIds = state.terminalIds;
    let newLayout = state.layout;

    if (state.activeTabId === tabId) {
      const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
      const remainingOpen = newTabs.filter((t) => t.status === 'open');
      // Prefer the tab after the closed one, fall back to last remaining open tab
      const nextTab =
        remainingOpen.find((t) => {
          const idx = newTabs.findIndex((nt) => nt.id === t.id);
          return idx > tabIndex;
        }) || remainingOpen[remainingOpen.length - 1];

      if (nextTab) {
        newActiveTabId = nextTab.id;
        newTerminalIds = nextTab.terminalIds;
        newLayout = nextTab.layout;
      }
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveTabId,
      terminalsMap: newTerminalsMap,
      terminalIds: newTerminalIds,
      layout: newLayout,
    });
    persistTabs(toPersistable(get()));
  },

  reopenTab: (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab || tab.status !== 'closed') return;

    // Recreate TerminalInstances in terminalsMap
    const newTerminalsMap = { ...state.terminalsMap };
    for (const tid of tab.terminalIds) {
      newTerminalsMap[tid] = { id: tid, connected: false, sessionResumed: false, error: null, panels: tab.panelStates?.[tid] || { chatOpen: false, planOpen: false } };
    }

    const newTabs = updateTab(state.tabs, tabId, (t) => ({
      ...t,
      status: 'open' as const,
    }));

    set({
      tabs: newTabs,
      activeTabId: tabId,
      terminalsMap: newTerminalsMap,
      terminalIds: tab.terminalIds,
      layout: tab.layout,
    });
    persistTabs(toPersistable(get()));
  },

  deleteTab: async (tabId) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Kill tmux sessions for every terminal in the tab
    const token = state.token;
    if (token) {
      await Promise.all(
        tab.terminalIds.map((tid) =>
          fetch(`${API_BASE}/api/sessions/${encodeURIComponent(tid)}`, {
            method: 'DELETE',
            headers: authHeaders(token),
          }).catch(() => {}),
        ),
      );
    }

    // Re-read state after async operations (state may have changed)
    const current = get();
    const currentTab = current.tabs.find((t) => t.id === tabId);
    if (!currentTab) return; // already deleted while awaiting

    // Remove terminals from map
    const newTerminalsMap = { ...current.terminalsMap };
    for (const tid of currentTab.terminalIds) {
      delete newTerminalsMap[tid];
    }

    // Remove tab entirely
    const newTabs = current.tabs.filter((t) => t.id !== tabId);

    // Handle active tab switch
    let newActiveTabId = current.activeTabId;
    let newTerminalIds = current.terminalIds;
    let newLayout = current.layout;

    if (current.activeTabId === tabId) {
      const openTab = newTabs.find((t) => t.status === 'open');
      if (openTab) {
        newActiveTabId = openTab.id;
        newTerminalIds = openTab.terminalIds;
        newLayout = openTab.layout;
      } else {
        newActiveTabId = '';
        newTerminalIds = [];
        newLayout = null;
      }
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveTabId,
      terminalsMap: newTerminalsMap,
      terminalIds: newTerminalIds,
      layout: newLayout,
    });
    persistTabs(toPersistable(get()));

    // Refresh server sessions list
    setTimeout(() => get().fetchSessions(), 500);
  },

  renameTab: (tabId, name) => {
    const newTabs = updateTab(get().tabs, tabId, (t) => ({ ...t, name }));
    set({ tabs: newTabs });
    persistTabs(toPersistable(get()));
  },

  // --- Terminal actions (scoped to active tab) --------------------------------

  addTerminal: (direction, customSessionId) => {
    const state = get();

    // If restoring a session that's already open in any tab, skip
    if (customSessionId && state.terminalsMap[customSessionId]) {
      return customSessionId;
    }

    const activeTab = getActiveTab(state);

    // No active tab — create one with the requested terminal
    if (!activeTab) {
      const tabId = `tab${state.nextTabId}`;
      const id = customSessionId || `t${state.nextId}`;

      let newNextId = state.nextId;
      const match = id.match(/^t(\d+)$/);
      if (match) newNextId = Math.max(newNextId, parseInt(match[1], 10) + 1);
      const finalNextId = customSessionId ? newNextId : newNextId + 1;

      const terminal: TerminalInstance = {
        id,
        connected: false,
        sessionResumed: false,
        error: null,
        panels: { chatOpen: false, planOpen: false },
      };
      const leaf: LayoutNode = { type: 'leaf', terminalId: id };
      const tab: TabState = {
        id: tabId,
        name: `Tab ${state.nextTabId}`,
        status: 'open',
        terminalIds: [id],
        layout: leaf,
        createdAt: Date.now(),
      };

      set({
        tabs: [...state.tabs, tab],
        activeTabId: tabId,
        nextTabId: state.nextTabId + 1,
        nextId: finalNextId,
        terminalsMap: { ...state.terminalsMap, [id]: terminal },
        terminalIds: [id],
        layout: leaf,
      });
      persistTabs(toPersistable(get()));
      return id;
    }

    // Active tab exists — add terminal to it
    const { nextId, nextSplitId, terminalsMap } = state;
    const { terminalIds, layout } = activeTab;

    const id = customSessionId || `t${nextId}`;

    // Ensure nextId stays ahead of any existing or restored terminal numeric IDs
    let newNextId = nextId;
    const match = id.match(/^t(\d+)$/);
    if (match) {
      newNextId = Math.max(newNextId, parseInt(match[1], 10) + 1);
    }

    const newTerminal: TerminalInstance = {
      id,
      connected: false,
      sessionResumed: false,
      error: null,
      panels: { chatOpen: false, planOpen: false },
    };
    const newLeaf: LayoutNode = { type: 'leaf', terminalId: id };

    let newLayout: LayoutNode;
    let newNextSplitId = nextSplitId;

    if (!layout) {
      newLayout = newLeaf;
    } else if (layout.type === 'leaf') {
      const dir = direction || 'horizontal';
      newLayout = {
        id: `s${newNextSplitId}`,
        type: 'split',
        direction: dir,
        children: [layout, newLeaf],
        sizes: [50, 50],
      };
      newNextSplitId++;
    } else if (layout.direction === (direction || 'horizontal')) {
      const count = layout.children.length + 1;
      // Proportionally shrink existing panes to preserve user-customized ratios
      const share = 100 / count;
      const scale = (100 - share) / 100;
      const newSizes = [...layout.sizes.map((s) => s * scale), share];
      newLayout = {
        ...layout,
        children: [...layout.children, newLeaf],
        sizes: newSizes,
      };
    } else {
      const dir = direction || 'horizontal';
      newLayout = {
        id: `s${newNextSplitId}`,
        type: 'split',
        direction: dir,
        children: [layout, newLeaf],
        sizes: [50, 50],
      };
      newNextSplitId++;
    }

    const newTerminalIds = [...terminalIds, id];
    const finalNextId = customSessionId ? newNextId : newNextId + 1;

    const newTabs = updateTab(state.tabs, activeTab.id, (t) => ({
      ...t,
      terminalIds: newTerminalIds,
      layout: newLayout,
    }));

    set({
      terminalsMap: { ...terminalsMap, [id]: newTerminal },
      terminalIds: newTerminalIds,
      layout: newLayout,
      tabs: newTabs,
      nextId: finalNextId,
      nextSplitId: newNextSplitId,
    });
    persistTabs(toPersistable(get()));
    return id;
  },

  splitTerminal: (terminalId, direction, startCwd) => {
    const state = get();
    const activeTab = getActiveTab(state);
    if (!activeTab || !activeTab.layout) return '';

    const { nextId, nextSplitId, terminalsMap } = state;

    const id = `t${nextId}`;
    const newTerminal: TerminalInstance = {
      id,
      connected: false,
      sessionResumed: false,
      error: null,
      panels: { chatOpen: false, planOpen: false },
      ...(startCwd ? { startCwd } : {}),
    };
    const newLeaf: LayoutNode = { type: 'leaf', terminalId: id };
    const splitId = `s${nextSplitId}`;

    const newLayout = splitLeafInTree(activeTab.layout, terminalId, direction, newLeaf, splitId);
    const newTerminalIds = [...activeTab.terminalIds, id];
    const newNextId = nextId + 1;
    const newNextSplitId = nextSplitId + 1;

    const newTabs = updateTab(state.tabs, activeTab.id, (t) => ({
      ...t,
      terminalIds: newTerminalIds,
      layout: newLayout,
    }));

    set({
      terminalsMap: { ...terminalsMap, [id]: newTerminal },
      terminalIds: newTerminalIds,
      layout: newLayout,
      tabs: newTabs,
      nextId: newNextId,
      nextSplitId: newNextSplitId,
    });
    persistTabs(toPersistable(get()));
    return id;
  },

  removeTerminal: (id) => {
    const update = removeTerminalFromState(get(), id);
    if (update) {
      set(update);
      persistTabs(toPersistable(get()));
    }
  },

  // --- Terminal connection state (unchanged, global) --------------------------

  setTerminalConnected: (id, connected) => {
    set((state) => {
      const existing = state.terminalsMap[id];
      if (!existing || existing.connected === connected) return state;
      return { terminalsMap: { ...state.terminalsMap, [id]: { ...existing, connected } } };
    });
  },

  setTerminalResumed: (id, resumed) => {
    set((state) => {
      const existing = state.terminalsMap[id];
      if (!existing || existing.sessionResumed === resumed) return state;
      return {
        terminalsMap: { ...state.terminalsMap, [id]: { ...existing, sessionResumed: resumed } },
      };
    });
  },

  setTerminalError: (id, error) => {
    set((state) => {
      const existing = state.terminalsMap[id];
      if (!existing || existing.error === error) return state;
      return { terminalsMap: { ...state.terminalsMap, [id]: { ...existing, error } } };
    });
  },

  toggleChat: (id) => {
    const state = get();
    const existing = state.terminalsMap[id];
    if (!existing) return;

    const newPanels: PanelState = { ...existing.panels, chatOpen: !existing.panels.chatOpen };
    const newTerminalsMap = { ...state.terminalsMap, [id]: { ...existing, panels: newPanels } };

    const ownerTab = state.tabs.find((t) => t.terminalIds.includes(id));
    let newTabs = state.tabs;
    if (ownerTab) {
      const states = { ...ownerTab.panelStates, [id]: newPanels };
      newTabs = updateTab(state.tabs, ownerTab.id, (t) => ({ ...t, panelStates: states }));
    }

    set({ terminalsMap: newTerminalsMap, tabs: newTabs });
    persistTabs(toPersistable(get()));
  },

  togglePlan: (id) => {
    const state = get();
    const existing = state.terminalsMap[id];
    if (!existing) return;

    const newPanels: PanelState = { ...existing.panels, planOpen: !existing.panels.planOpen };
    const newTerminalsMap = { ...state.terminalsMap, [id]: { ...existing, panels: newPanels } };

    const ownerTab = state.tabs.find((t) => t.terminalIds.includes(id));
    let newTabs = state.tabs;
    if (ownerTab) {
      const states = { ...ownerTab.panelStates, [id]: newPanels };
      newTabs = updateTab(state.tabs, ownerTab.id, (t) => ({ ...t, panelStates: states }));
    }

    set({ terminalsMap: newTerminalsMap, tabs: newTabs });
    persistTabs(toPersistable(get()));
  },

  // --- Layout (scoped to active tab) ------------------------------------------

  setSplitSizes: (splitId, sizes) => {
    const state = get();
    const activeTab = getActiveTab(state);
    if (!activeTab || !activeTab.layout) return;

    const newLayout = updateSplitSizes(activeTab.layout, splitId, sizes);
    const newTabs = updateTab(state.tabs, activeTab.id, (t) => ({ ...t, layout: newLayout }));

    set({ layout: newLayout, tabs: newTabs });
    persistTabsDebounced(toPersistable(get()));
  },

  // --- Font size --------------------------------------------------------------

  fontSize: 14,

  setFontSize: (size) => {
    const clamped = Math.max(10, Math.min(24, size));
    set({ fontSize: clamped });
    // Debounce the API call to avoid rapid-fire requests when clicking A+/A- repeatedly
    if (fontSizeTimer) clearTimeout(fontSizeTimer);
    fontSizeTimer = setTimeout(() => {
      fontSizeTimer = null;
      const token = get().token;
      if (token) {
        saveFontSize(token, clamped);
      }
    }, 500);
  },

  // --- Network ----------------------------------------------------------------

  latency: null,
  setLatency: (latency) => set({ latency }),

  // --- Theme -----------------------------------------------------------------

  theme: (() => {
    try {
      const saved = localStorage.getItem('ai-cli-online-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return 'dark';
  })() as 'dark' | 'light',

  setTheme: (theme) => {
    set({ theme });
    try { localStorage.setItem('ai-cli-online-theme', theme); } catch { /* ignore */ }
    document.documentElement.setAttribute('data-theme', theme);
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  // --- Sidebar ----------------------------------------------------------------

  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  serverSessions: [],

  fetchSessions: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return;
      const data: ServerSession[] = await res.json();
      set({ serverSessions: data });
    } catch {
      // ignore fetch errors
    }
  },

  killServerSession: async (sessionId) => {
    const token = get().token;
    if (!token) return;
    try {
      await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
    } catch {
      // ignore
    }

    // Find owning tab and remove the terminal from it
    const update = removeTerminalFromState(get(), sessionId);
    if (update) {
      set(update);
      persistTabs(toPersistable(get()));
    }

    // Small delay to let tmux finish killing the session before refreshing
    setTimeout(() => get().fetchSessions(), 500);
  },
}));

// Initialize data-theme attribute on document
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', useStore.getState().theme);
}

// ---------------------------------------------------------------------------
// Async server restore (called from setToken Phase 2)
// ---------------------------------------------------------------------------

async function restoreFromServer(
  token: string,
  localSaved: PersistedTabsState | null,
): Promise<void> {
  const { setState, getState } = useStore;

  try {
    // Fetch server layout and live tmux sessions in parallel
    const [serverLayout, sessionsRes] = await Promise.all([
      fetchTabsLayout(token),
      fetch(`${API_BASE}/api/sessions`, { headers: authHeaders(token) })
        .then((r) => (r.ok ? (r.json() as Promise<ServerSession[]>) : []))
        .catch(() => [] as ServerSession[]),
    ]);

    // Bail if user logged out while we were fetching
    if (getState().token !== token) return;

    // Choose source: prefer server data, fallback to localStorage
    const source = serverLayout && serverLayout.tabs?.length > 0 ? serverLayout : localSaved;

    if (!source || source.tabs.length === 0) {
      // No saved state anywhere — let App.tsx create default tab
      setState({ tabsLoading: false });
      return;
    }

    // Reconcile with live tmux sessions
    const reconciled = reconcileWithTmux(source, sessionsRes);

    if (!reconciled) {
      // All sessions dead — clear state, let App.tsx create default tab
      setState({
        tabsLoading: false,
        terminalsMap: {},
        tabs: [],
        activeTabId: '',
        nextId: source.nextId,
        nextSplitId: source.nextSplitId,
        nextTabId: source.nextTabId,
        terminalIds: [],
        layout: null,
      });
      return;
    }

    // Build terminalsMap from reconciled tabs, preserving live connection state
    const currentMap = getState().terminalsMap;
    const terminalsMap: Record<string, TerminalInstance> = {};
    for (const tab of reconciled.tabs) {
      if (tab.status === 'open') {
        for (const id of tab.terminalIds) {
          terminalsMap[id] = currentMap[id] || { id, connected: false, sessionResumed: false, error: null, panels: tab.panelStates?.[id] || { chatOpen: false, planOpen: false } };
        }
      }
    }

    const activeTab =
      reconciled.tabs.find((t) => t.id === reconciled.activeTabId && t.status === 'open') ||
      reconciled.tabs.find((t) => t.status === 'open');
    const activeTabId = activeTab?.id || '';

    setState({
      tabsLoading: false,
      terminalsMap,
      tabs: reconciled.tabs,
      activeTabId,
      nextId: reconciled.nextId,
      nextSplitId: reconciled.nextSplitId,
      nextTabId: reconciled.nextTabId,
      terminalIds: activeTab?.terminalIds || [],
      layout: activeTab?.layout || null,
    });

    // Sync reconciled state back to both localStorage and server
    persistTabs(toPersistable(getState()));

    // If server had no data but localStorage did, the persistTabs call above
    // will upload it via the debounced server save (first-time sync)
  } catch {
    // On any error, just stop loading — localStorage restore (Phase 1) is still active
    if (getState().token === token) {
      setState({ tabsLoading: false });
    }
  }
}
