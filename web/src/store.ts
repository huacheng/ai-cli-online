import { create } from 'zustand';
import type { TerminalInstance, LayoutNode, SplitDirection, ServerSession } from './types';

const SESSION_NAMES_KEY = 'cli-online-session-names';

function loadSessionNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(SESSION_NAMES_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSessionNames(names: Record<string, string>): void {
  localStorage.setItem(SESSION_NAMES_KEY, JSON.stringify(names));
}

// API base URL — always relative (Vite proxy handles dev mode)
const API_BASE = '';

// Helper: equal sizes for N children
function equalSizes(count: number): number[] {
  if (count === 0) return [];
  const size = 100 / count;
  return Array.from({ length: count }, () => size);
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

  terminals: TerminalInstance[];
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
      localStorage.setItem('cli-online-token', token);
    } else {
      localStorage.removeItem('cli-online-token');
    }
    set({ token, terminals: [], nextId: 1, nextSplitId: 1, layout: null });
  },

  terminals: [],
  nextId: 1,
  nextSplitId: 1,
  layout: null,

  addTerminal: (direction, customSessionId) => {
    const { nextId, nextSplitId, terminals, layout } = get();

    // If restoring a session that's already open, skip
    if (customSessionId && terminals.some((t) => t.id === customSessionId)) {
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
      // No layout yet -> single leaf
      newLayout = newLeaf;
    } else if (layout.type === 'leaf') {
      // Root is a leaf -> wrap in split
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
      // Root is same direction split -> append child
      const count = layout.children.length + 1;
      newLayout = {
        ...layout,
        children: [...layout.children, newLeaf],
        sizes: equalSizes(count),
      };
    } else {
      // Root is different direction -> wrap in new split
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

    set({
      terminals: [...terminals, newTerminal],
      nextId: customSessionId ? newNextId : newNextId + 1,
      nextSplitId: newNextSplitId,
      layout: newLayout,
    });
    return id;
  },

  splitTerminal: (terminalId, direction) => {
    const { nextId, nextSplitId, terminals, layout } = get();
    if (!layout) return '';

    const id = `t${nextId}`;
    const newTerminal: TerminalInstance = { id, connected: false, sessionResumed: false, error: null };
    const newLeaf: LayoutNode = { type: 'leaf', terminalId: id };
    const splitId = `s${nextSplitId}`;

    const newLayout = splitLeafInTree(layout, terminalId, direction, newLeaf, splitId);

    set({
      terminals: [...terminals, newTerminal],
      nextId: nextId + 1,
      nextSplitId: nextSplitId + 1,
      layout: newLayout,
    });
    return id;
  },

  removeTerminal: (id) => {
    const { terminals, layout } = get();
    const newTerminals = terminals.filter((t) => t.id !== id);
    const newLayout = layout ? removeLeafFromTree(layout, id) : null;
    set({ terminals: newTerminals, layout: newLayout });
  },

  setTerminalConnected: (id, connected) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, connected } : t,
      ),
    }));
  },

  setTerminalResumed: (id, resumed) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, sessionResumed: resumed } : t,
      ),
    }));
  },

  setTerminalError: (id, error) => {
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === id ? { ...t, error } : t,
      ),
    }));
  },

  setSplitSizes: (splitId, sizes) => {
    const { layout } = get();
    if (!layout) return;
    set({ layout: updateSplitSizes(layout, splitId, sizes) });
  },

  // Sidebar
  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  serverSessions: [],
  fetchSessions: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        headers: { 'Authorization': `Bearer ${token}` },
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
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch {
      // ignore
    }
    // Remove from local terminals if open
    get().removeTerminal(sessionId);
    // Refresh list
    get().fetchSessions();
  },

  sessionNames: loadSessionNames(),
  renameSession: (sessionId, name) => {
    const updated = { ...get().sessionNames, [sessionId]: name };
    if (!name) delete updated[sessionId];
    saveSessionNames(updated);
    set({ sessionNames: updated });
  },
}));
