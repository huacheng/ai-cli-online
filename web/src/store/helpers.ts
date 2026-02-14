import type { LayoutNode, SplitDirection, TabState } from '../types';
import type { AppState } from './types';

// ---------------------------------------------------------------------------
// Tree helpers — pure functions for layout tree manipulation
// ---------------------------------------------------------------------------

export function removeLeafFromTree(node: LayoutNode, terminalId: string): LayoutNode | null {
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

  const total = newSizes.reduce((a, b) => a + b, 0);
  const normalizedSizes = newSizes.map((s) => (s / total) * 100);

  return { ...node, children: newChildren, sizes: normalizedSizes };
}

export function splitLeafInTree(
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

export function updateSplitSizes(node: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
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

export function getActiveTab(state: { tabs: TabState[]; activeTabId: string }): TabState | undefined {
  return state.tabs.find((t) => t.id === state.activeTabId);
}

export function updateTab(
  tabs: TabState[],
  tabId: string,
  updater: (tab: TabState) => TabState,
): TabState[] {
  return tabs.map((t) => (t.id === tabId ? updater(t) : t));
}

// ---------------------------------------------------------------------------
// Shared terminal removal helper
// ---------------------------------------------------------------------------

export function removeTerminalFromState(
  state: AppState,
  terminalId: string,
): Partial<AppState> | null {
  const ownerTab = state.tabs.find((t) => t.terminalIds.includes(terminalId));

  if (!ownerTab) {
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

  if (ownerTab.id === state.activeTabId) {
    update.terminalIds = newTabTerminalIds;
    update.layout = newTabLayout;
  }

  return update;
}
