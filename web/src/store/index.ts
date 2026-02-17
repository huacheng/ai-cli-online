import { create } from 'zustand';
import type {
  TerminalInstance,
  PanelState,
  LayoutNode,
  TabState,
} from '../types';
import { API_BASE, authHeaders } from '../api/client';
import { fetchFontSize } from '../api/settings';
import type { AppState } from './types';
import { createSettingsSlice } from './settingsSlice';
import {
  getActiveTab,
  updateTab,
  splitLeafInTree,
  updateSplitSizes,
  removeTerminalFromState,
} from './helpers';
import {
  loadTabs,
  persistTabs,
  persistTabsDebounced,
  toPersistable,
  restoreFromServer,
  bindStore,
} from './persistence';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useStore = create<AppState>((...args) => {
  const [set, get] = args;

  return {
    // --- Settings slice (independent) ---
    ...createSettingsSlice(...args),

    // --- Auth ---------------------------------------------------------------

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

        // Phase 1: synchronous localStorage restore (fast render)
        const localSaved = loadTabs();
        if (localSaved && localSaved.tabs.length > 0) {
          const terminalsMap: Record<string, TerminalInstance> = {};
          for (const tab of localSaved.tabs) {
            if (tab.status === 'open') {
              for (const id of tab.terminalIds) {
                terminalsMap[id] = {
                  id,
                  connected: false,
                  sessionResumed: false,
                  error: null,
                  panels: tab.panelStates?.[id] || { chatOpen: false, planOpen: false, gitHistoryOpen: false },
                };
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

        // Phase 2: async server restore + tmux reconciliation
        restoreFromServer(token, localSaved);
        return;
      }

      // Logout
      localStorage.removeItem('ai-cli-online-token');
      localStorage.removeItem('ai-cli-online-tabs');

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

    // --- Global state -------------------------------------------------------

    terminalsMap: {},
    terminalIds: [],
    layout: null,
    nextId: 1,
    nextSplitId: 1,

    // --- Tab state ----------------------------------------------------------

    tabs: [],
    activeTabId: '',
    nextTabId: 1,

    // --- Tab actions --------------------------------------------------------

    addTab: (name) => {
      const state = get();
      const tabId = `tab${state.nextTabId}`;
      const termId = `t${state.nextId}`;
      const terminal: TerminalInstance = {
        id: termId,
        connected: false,
        sessionResumed: false,
        error: null,
        panels: { chatOpen: false, planOpen: false, gitHistoryOpen: false },
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

      const openTabs = state.tabs.filter((t) => t.status === 'open');
      if (openTabs.length <= 1) return;

      const newTerminalsMap = { ...state.terminalsMap };
      for (const tid of tab.terminalIds) {
        delete newTerminalsMap[tid];
      }

      const newTabs = updateTab(state.tabs, tabId, (t) => ({
        ...t,
        status: 'closed' as const,
      }));

      let newActiveTabId = state.activeTabId;
      let newTerminalIds = state.terminalIds;
      let newLayout = state.layout;

      if (state.activeTabId === tabId) {
        const tabIndex = state.tabs.findIndex((t) => t.id === tabId);
        const remainingOpen = newTabs.filter((t) => t.status === 'open');
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

      const newTerminalsMap = { ...state.terminalsMap };
      for (const tid of tab.terminalIds) {
        newTerminalsMap[tid] = {
          id: tid,
          connected: false,
          sessionResumed: false,
          error: null,
          panels: tab.panelStates?.[tid] || { chatOpen: false, planOpen: false, gitHistoryOpen: false },
        };
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

      const current = get();
      const currentTab = current.tabs.find((t) => t.id === tabId);
      if (!currentTab) return;

      const newTerminalsMap = { ...current.terminalsMap };
      for (const tid of currentTab.terminalIds) {
        delete newTerminalsMap[tid];
      }

      const newTabs = current.tabs.filter((t) => t.id !== tabId);

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

      setTimeout(() => get().fetchSessions(), 500);
    },

    renameTab: (tabId, name) => {
      const newTabs = updateTab(get().tabs, tabId, (t) => ({ ...t, name }));
      set({ tabs: newTabs });
      persistTabs(toPersistable(get()));
    },

    // --- Terminal actions (scoped to active tab) ----------------------------

    addTerminal: (direction, customSessionId) => {
      const state = get();

      if (customSessionId && state.terminalsMap[customSessionId]) {
        return customSessionId;
      }

      const activeTab = getActiveTab(state);

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
          panels: { chatOpen: false, planOpen: false, gitHistoryOpen: false },
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

      const { nextId, nextSplitId, terminalsMap } = state;
      const { terminalIds, layout } = activeTab;

      const id = customSessionId || `t${nextId}`;

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
        panels: { chatOpen: false, planOpen: false, gitHistoryOpen: false },
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
        panels: { chatOpen: false, planOpen: false, gitHistoryOpen: false },
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

    disconnectTerminal: (id) => {
      const state = get();
      const existing = state.terminalsMap[id];
      if (!existing) return;
      const { [id]: _, ...rest } = state.terminalsMap;
      set({ terminalsMap: rest });
    },

    reconnectTerminal: (id) => {
      const state = get();
      if (state.terminalsMap[id]) return;
      const ownerTab = state.tabs.find((t) => t.terminalIds.includes(id));
      const panels = ownerTab?.panelStates?.[id] || { chatOpen: false, planOpen: false, gitHistoryOpen: false };
      const terminal: TerminalInstance = {
        id,
        connected: false,
        sessionResumed: false,
        error: null,
        panels,
      };
      set({ terminalsMap: { ...state.terminalsMap, [id]: terminal } });
    },

    // --- Terminal connection state ------------------------------------------

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

      const opening = !existing.panels.planOpen;
      const newPanels: PanelState = {
        ...existing.panels,
        planOpen: opening,
        ...(opening ? { gitHistoryOpen: false } : {}),
      };
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

    toggleGitHistory: (id) => {
      const state = get();
      const existing = state.terminalsMap[id];
      if (!existing) return;

      const opening = !existing.panels.gitHistoryOpen;
      const newPanels: PanelState = {
        ...existing.panels,
        gitHistoryOpen: opening,
        ...(opening ? { planOpen: false } : {}),
      };
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

    // --- Layout (scoped to active tab) --------------------------------------

    setSplitSizes: (splitId, sizes) => {
      const state = get();
      const activeTab = getActiveTab(state);
      if (!activeTab || !activeTab.layout) return;

      const newLayout = updateSplitSizes(activeTab.layout, splitId, sizes);
      const newTabs = updateTab(state.tabs, activeTab.id, (t) => ({ ...t, layout: newLayout }));

      set({ layout: newLayout, tabs: newTabs });
      persistTabsDebounced(toPersistable(get()));
    },

    // --- Sidebar session management -----------------------------------------

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

      const update = removeTerminalFromState(get(), sessionId);
      if (update) {
        set(update);
        persistTabs(toPersistable(get()));
      }

      setTimeout(() => get().fetchSessions(), 500);
    },
  };
});

// ---------------------------------------------------------------------------
// Post-creation setup
// ---------------------------------------------------------------------------

// Bind store to persistence module (avoids circular imports)
bindStore(useStore);

// Initialize data-theme attribute
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', useStore.getState().theme);
}
