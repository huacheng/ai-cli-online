import { create } from 'zustand';
import type { TerminalInstance, LayoutNode, SplitDirection, ServerSession } from './types';
import { API_BASE, authHeaders } from './api/client';

const SESSION_NAMES_KEY = 'cli-online-session-names';
const LAYOUT_KEY = 'cli-online-layout';

function loadSessionNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SESSION_NAMES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSessionNames(names: Record<string, string>): void {
  try { localStorage.setItem(SESSION_NAMES_KEY, JSON.stringify(names)); } catch { /* storage full */ }
}

interface PersistedLayout {
  terminalIds: string[];
  layout: LayoutNode | null;
  nextId: number;
  nextSplitId: number;
}

function loadLayout(): PersistedLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

let saveLayoutTimer: ReturnType<typeof setTimeout> | null = null;
function saveLayout(state: PersistedLayout): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(state)); } catch { /* storage full */ }
}
/** Debounced saveLayout for high-frequency calls (e.g., drag-resize) */
function saveLayoutDebounced(state: PersistedLayout): void {
  if (saveLayoutTimer) clearTimeout(saveLayoutTimer);
  saveLayoutTimer = setTimeout(() => {
    saveLayoutTimer = null;
    saveLayout(state);
  }, 500);
}

// Helper: remove a leaf from the tree, collapsing single-child splits
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

// Helper: split a specific leaf into a split node
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

// Helper: update sizes for a specific split node
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

interface AppState {
  token: string | null;
  setToken: (token: string | null) => void;

  /** Terminal instances indexed by ID for O(1) lookup and isolated re-renders */
  terminalsMap: Record<string, TerminalInstance>;
  /** Ordered list of terminal IDs (preserves insertion order) */
  terminalIds: string[];
  nextId: number;
  nextSplitId: number;
  layout: LayoutNode | null;

  addTerminal: (direction?: SplitDirection, customSessionId?: string) => string;
  splitTerminal: (terminalId: string, direction: SplitDirection) => string;
  removeTerminal: (id: string) => void;

  setTerminalConnected: (id: string, connected: boolean) => void;
  setTerminalResumed: (id: string, resumed: boolean) => void;
  setTerminalError: (id: string, error: string | null) => void;

  setSplitSizes: (splitId: string, sizes: number[]) => void;

  /** Global network latency (ms), measured via any active WebSocket ping/pong */
  latency: number | null;
  setLatency: (latency: number | null) => void;

  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  serverSessions: ServerSession[];
  fetchSessions: () => Promise<void>;
  killServerSession: (sessionId: string) => Promise<void>;
  sessionNames: Record<string, string>;
  renameSession: (sessionId: string, name: string) => void;
}

export const useStore = create<AppState>((set, get) => ({
  token: null,
  setToken: (token) => {
    if (token) {
      try { localStorage.setItem('cli-online-token', token); } catch { /* storage full */ }
      // Restore persisted layout if available
      const saved = loadLayout();
      if (saved && saved.terminalIds.length > 0) {
        const terminalsMap: Record<string, TerminalInstance> = {};
        for (const id of saved.terminalIds) {
          terminalsMap[id] = { id, connected: false, sessionResumed: false, error: null };
        }
        set({
          token,
          terminalsMap,
          terminalIds: saved.terminalIds,
          nextId: saved.nextId,
          nextSplitId: saved.nextSplitId,
          layout: saved.layout,
        });
        return;
      }
    } else {
      localStorage.removeItem('cli-online-token');
      localStorage.removeItem(LAYOUT_KEY);
    }
    set({ token, terminalsMap: {}, terminalIds: [], nextId: 1, nextSplitId: 1, layout: null });
  },

  terminalsMap: {},
  terminalIds: [],
  nextId: 1,
  nextSplitId: 1,
  layout: null,

  addTerminal: (direction, customSessionId) => {
    const { nextId, nextSplitId, terminalsMap, terminalIds, layout } = get();

    // If restoring a session that's already open, skip
    if (customSessionId && terminalsMap[customSessionId]) {
      return customSessionId;
    }

    const id = customSessionId || `t${nextId}`;

    // Ensure nextId stays ahead of any existing or restored terminal numeric IDs
    let newNextId = nextId;
    const match = id.match(/^t(\d+)$/);
    if (match) {
      newNextId = Math.max(newNextId, parseInt(match[1], 10) + 1);
    }

    const newTerminal: TerminalInstance = { id, connected: false, sessionResumed: false, error: null };
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
      const newSizes = [...layout.sizes.map(s => s * scale), share];
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
    set({
      terminalsMap: { ...terminalsMap, [id]: newTerminal },
      terminalIds: newTerminalIds,
      nextId: finalNextId,
      nextSplitId: newNextSplitId,
      layout: newLayout,
    });
    saveLayout({ terminalIds: newTerminalIds, layout: newLayout, nextId: finalNextId, nextSplitId: newNextSplitId });
    return id;
  },

  splitTerminal: (terminalId, direction) => {
    const { nextId, nextSplitId, terminalsMap, terminalIds, layout } = get();
    if (!layout) return '';

    const id = `t${nextId}`;
    const newTerminal: TerminalInstance = { id, connected: false, sessionResumed: false, error: null };
    const newLeaf: LayoutNode = { type: 'leaf', terminalId: id };
    const splitId = `s${nextSplitId}`;

    const newLayout = splitLeafInTree(layout, terminalId, direction, newLeaf, splitId);

    const newTerminalIds = [...terminalIds, id];
    const newNextId = nextId + 1;
    const newNextSplitId = nextSplitId + 1;
    set({
      terminalsMap: { ...terminalsMap, [id]: newTerminal },
      terminalIds: newTerminalIds,
      nextId: newNextId,
      nextSplitId: newNextSplitId,
      layout: newLayout,
    });
    saveLayout({ terminalIds: newTerminalIds, layout: newLayout, nextId: newNextId, nextSplitId: newNextSplitId });
    return id;
  },

  removeTerminal: (id) => {
    const { terminalsMap, terminalIds, layout, nextId, nextSplitId } = get();
    const { [id]: _removed, ...rest } = terminalsMap;
    const newLayout = layout ? removeLeafFromTree(layout, id) : null;
    const newTerminalIds = terminalIds.filter((tid) => tid !== id);
    set({ terminalsMap: rest, terminalIds: newTerminalIds, layout: newLayout });
    saveLayout({ terminalIds: newTerminalIds, layout: newLayout, nextId, nextSplitId });
  },

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
      return { terminalsMap: { ...state.terminalsMap, [id]: { ...existing, sessionResumed: resumed } } };
    });
  },

  setTerminalError: (id, error) => {
    set((state) => {
      const existing = state.terminalsMap[id];
      if (!existing || existing.error === error) return state;
      return { terminalsMap: { ...state.terminalsMap, [id]: { ...existing, error } } };
    });
  },

  setSplitSizes: (splitId, sizes) => {
    const { layout, terminalIds, nextId, nextSplitId } = get();
    if (!layout) return;
    const newLayout = updateSplitSizes(layout, splitId, sizes);
    set({ layout: newLayout });
    saveLayoutDebounced({ terminalIds, layout: newLayout, nextId, nextSplitId });
  },

  latency: null,
  setLatency: (latency) => set({ latency }),

  // Sidebar
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
    get().removeTerminal(sessionId);
    // Small delay to let tmux finish killing the session before refreshing the list
    setTimeout(() => get().fetchSessions(), 500);
  },

  sessionNames: loadSessionNames(),
  renameSession: (sessionId, name) => {
    const updated = { ...get().sessionNames, [sessionId]: name };
    if (!name) delete updated[sessionId];
    saveSessionNames(updated);
    set({ sessionNames: updated });
  },
}));
