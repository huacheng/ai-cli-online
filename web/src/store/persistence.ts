import type {
  TerminalInstance,
  LayoutNode,
  TabState,
  PersistedTabsState,
  ServerSession,
} from '../types';
import { API_BASE, authHeaders } from '../api/client';
import { fetchTabsLayout, saveTabsLayout, saveTabsLayoutBeacon } from '../api/tabs';
import type { AppState, PersistableFields } from './types';
import { removeLeafFromTree } from './helpers';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS_KEY = 'ai-cli-online-tabs';
const LEGACY_LAYOUT_KEY = 'ai-cli-online-layout';
const LEGACY_SESSION_NAMES_KEY = 'ai-cli-online-session-names';

interface LegacyPersistedLayout {
  terminalIds: string[];
  layout: LayoutNode | null;
  nextId: number;
  nextSplitId: number;
}

// ---------------------------------------------------------------------------
// Store binding (avoids circular import)
// ---------------------------------------------------------------------------

type StoreApi = {
  getState: () => AppState;
  setState: (partial: Partial<AppState>) => void;
};

let _store: StoreApi | null = null;

export function bindStore(store: StoreApi): void {
  _store = store;
  setupBeforeUnload();
}

// ---------------------------------------------------------------------------
// Persistence timers
// ---------------------------------------------------------------------------

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let serverPersistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingServerLayout: PersistedTabsState | null = null;

function persistTabsToServer(data: PersistedTabsState): void {
  pendingServerLayout = data;
  if (serverPersistTimer) clearTimeout(serverPersistTimer);
  serverPersistTimer = setTimeout(() => {
    serverPersistTimer = null;
    pendingServerLayout = null;
    const token = _store?.getState().token;
    if (token) {
      saveTabsLayout(token, data);
    }
  }, 2000);
}

// ---------------------------------------------------------------------------
// Public persistence API
// ---------------------------------------------------------------------------

export function persistTabs(state: PersistableFields): void {
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

export function persistTabsDebounced(state: PersistableFields): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistTabs(state);
  }, 500);
}

export function toPersistable(state: AppState): PersistableFields {
  return {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    nextId: state.nextId,
    nextSplitId: state.nextSplitId,
    nextTabId: state.nextTabId,
  };
}

// ---------------------------------------------------------------------------
// Load persisted tabs (v2) or migrate from v1
// ---------------------------------------------------------------------------

export function loadTabs(): PersistedTabsState | null {
  // Try v2 format
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 2) return parsed as PersistedTabsState;
    }
  } catch {
    /* corrupt data */
  }

  // Migrate from v1 (old layout + session names)
  try {
    const raw = localStorage.getItem(LEGACY_LAYOUT_KEY);
    if (raw) {
      const legacy: LegacyPersistedLayout = JSON.parse(raw);

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

// ---------------------------------------------------------------------------
// tmux reconciliation
// ---------------------------------------------------------------------------

export function reconcileWithTmux(
  saved: PersistedTabsState,
  liveSessions: ServerSession[],
): PersistedTabsState | null {
  const liveIds = new Set(liveSessions.map((s) => s.sessionId));

  const reconciledTabs: TabState[] = [];
  for (const tab of saved.tabs) {
    if (tab.status !== 'open') {
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
      continue;
    }

    const aliveIds = tab.terminalIds.filter((id) => liveIds.has(id));
    if (aliveIds.length === 0) continue;

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

  let activeTabId = saved.activeTabId;
  const activeExists = reconciledTabs.find(
    (t) => t.id === activeTabId && t.status === 'open',
  );
  if (!activeExists) {
    const firstOpen = reconciledTabs.find((t) => t.status === 'open');
    activeTabId = firstOpen?.id || '';
  }

  return { ...saved, activeTabId, tabs: reconciledTabs };
}

// ---------------------------------------------------------------------------
// Async server restore (called from setToken)
// ---------------------------------------------------------------------------

export async function restoreFromServer(
  token: string,
  localSaved: PersistedTabsState | null,
): Promise<void> {
  if (!_store) return;
  const { setState, getState } = _store;

  try {
    const [serverLayout, sessionsRes] = await Promise.all([
      fetchTabsLayout(token),
      fetch(`${API_BASE}/api/sessions`, { headers: authHeaders(token) })
        .then((r) => (r.ok ? (r.json() as Promise<ServerSession[]>) : []))
        .catch(() => [] as ServerSession[]),
    ]);

    if (getState().token !== token) return;

    const source = serverLayout && serverLayout.tabs?.length > 0 ? serverLayout : localSaved;

    if (!source || source.tabs.length === 0) {
      setState({ tabsLoading: false });
      return;
    }

    const reconciled = reconcileWithTmux(source, sessionsRes);

    if (!reconciled) {
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

    const currentMap = getState().terminalsMap;
    const terminalsMap: Record<string, TerminalInstance> = {};
    for (const tab of reconciled.tabs) {
      if (tab.status === 'open') {
        for (const id of tab.terminalIds) {
          terminalsMap[id] = currentMap[id] || {
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

    persistTabs(toPersistable(getState()));
  } catch {
    if (getState().token === token) {
      setState({ tabsLoading: false });
    }
  }
}

// ---------------------------------------------------------------------------
// beforeunload — flush pending layout via sendBeacon
// ---------------------------------------------------------------------------

function setupBeforeUnload(): void {
  if (typeof window === 'undefined' || !_store) return;

  window.addEventListener('beforeunload', () => {
    const token = _store?.getState().token;
    if (!token) return;

    if (pendingServerLayout) {
      if (serverPersistTimer) {
        clearTimeout(serverPersistTimer);
        serverPersistTimer = null;
      }
      saveTabsLayoutBeacon(token, pendingServerLayout);
      pendingServerLayout = null;
    } else {
      const state = _store!.getState();
      if (state.tabs.length > 0) {
        saveTabsLayoutBeacon(token, toPersistable(state) as PersistedTabsState);
      }
    }
  });
}
