import { describe, it, expect, vi } from 'vitest';
import {
  panelToggle,
  removeLeafFromTree,
  splitLeafInTree,
  updateSplitSizes,
} from './helpers';
import type { LayoutNode, PanelState } from '../types';
import type { AppState } from './types';

// ---------------------------------------------------------------------------
// Helpers for building mock state
// ---------------------------------------------------------------------------

function makePanels(overrides: Partial<PanelState> = {}): PanelState {
  return { chatOpen: false, planOpen: false, gitHistoryOpen: false, ...overrides };
}

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    terminalsMap: {},
    tabs: [],
    activeTabId: '',
    ...overrides,
  } as AppState;
}

// ---------------------------------------------------------------------------
// panelToggle
// ---------------------------------------------------------------------------

describe('panelToggle', () => {
  it('opens a panel that is closed', () => {
    const state = makeState({
      terminalsMap: {
        t1: { id: 't1', connected: true, sessionResumed: false, error: null, panels: makePanels() },
      },
      tabs: [{ id: 'tab1', name: 'Tab1', status: 'open', terminalIds: ['t1'], layout: { type: 'leaf', terminalId: 't1' }, createdAt: 0 }],
    });

    const set = vi.fn();
    const get = vi.fn(() => state);

    panelToggle('chatOpen')('t1', get, set);

    expect(set).toHaveBeenCalledTimes(1);
    const update = set.mock.calls[0][0];
    expect(update.terminalsMap.t1.panels.chatOpen).toBe(true);
  });

  it('closes a panel that is open', () => {
    const state = makeState({
      terminalsMap: {
        t1: { id: 't1', connected: true, sessionResumed: false, error: null, panels: makePanels({ chatOpen: true }) },
      },
      tabs: [{ id: 'tab1', name: 'Tab1', status: 'open', terminalIds: ['t1'], layout: null, createdAt: 0 }],
    });

    const set = vi.fn();
    const get = vi.fn(() => state);

    panelToggle('chatOpen')('t1', get, set);

    const update = set.mock.calls[0][0];
    expect(update.terminalsMap.t1.panels.chatOpen).toBe(false);
  });

  it('closes mutually-exclusive panel when opening', () => {
    const state = makeState({
      terminalsMap: {
        t1: { id: 't1', connected: true, sessionResumed: false, error: null, panels: makePanels({ gitHistoryOpen: true }) },
      },
      tabs: [{ id: 'tab1', name: 'Tab1', status: 'open', terminalIds: ['t1'], layout: null, createdAt: 0 }],
    });

    const set = vi.fn();
    const get = vi.fn(() => state);

    panelToggle('planOpen', 'gitHistoryOpen')('t1', get, set);

    const update = set.mock.calls[0][0];
    expect(update.terminalsMap.t1.panels.planOpen).toBe(true);
    expect(update.terminalsMap.t1.panels.gitHistoryOpen).toBe(false);
  });

  it('does not open mutually-exclusive panel when closing', () => {
    const state = makeState({
      terminalsMap: {
        t1: { id: 't1', connected: true, sessionResumed: false, error: null, panels: makePanels({ planOpen: true }) },
      },
      tabs: [{ id: 'tab1', name: 'Tab1', status: 'open', terminalIds: ['t1'], layout: null, createdAt: 0 }],
    });

    const set = vi.fn();
    const get = vi.fn(() => state);

    panelToggle('planOpen', 'gitHistoryOpen')('t1', get, set);

    const update = set.mock.calls[0][0];
    expect(update.terminalsMap.t1.panels.planOpen).toBe(false);
    expect(update.terminalsMap.t1.panels.gitHistoryOpen).toBe(false);
  });

  it('is a no-op for non-existent terminal', () => {
    const state = makeState({ terminalsMap: {} });
    const set = vi.fn();
    const get = vi.fn(() => state);

    panelToggle('chatOpen')('nonexistent', get, set);

    expect(set).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeLeafFromTree
// ---------------------------------------------------------------------------

describe('removeLeafFromTree', () => {
  it('returns null for matching leaf', () => {
    const leaf: LayoutNode = { type: 'leaf', terminalId: 't1' };
    expect(removeLeafFromTree(leaf, 't1')).toBeNull();
  });

  it('returns original leaf for non-matching', () => {
    const leaf: LayoutNode = { type: 'leaf', terminalId: 't1' };
    expect(removeLeafFromTree(leaf, 't2')).toBe(leaf);
  });

  it('collapses split to single child when one removed', () => {
    const split: LayoutNode = {
      id: 's1',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', terminalId: 't1' },
        { type: 'leaf', terminalId: 't2' },
      ],
      sizes: [50, 50],
    };
    const result = removeLeafFromTree(split, 't1');
    expect(result).toEqual({ type: 'leaf', terminalId: 't2' });
  });

  it('normalizes sizes when removing from 3-child split', () => {
    const split: LayoutNode = {
      id: 's1',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', terminalId: 't1' },
        { type: 'leaf', terminalId: 't2' },
        { type: 'leaf', terminalId: 't3' },
      ],
      sizes: [33.33, 33.33, 33.34],
    };
    const result = removeLeafFromTree(split, 't2');
    expect(result).not.toBeNull();
    if (result && result.type === 'split') {
      expect(result.children).toHaveLength(2);
      const total = result.sizes.reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(100, 1);
    }
  });
});

// ---------------------------------------------------------------------------
// splitLeafInTree
// ---------------------------------------------------------------------------

describe('splitLeafInTree', () => {
  it('wraps matching leaf in a split node', () => {
    const leaf: LayoutNode = { type: 'leaf', terminalId: 't1' };
    const newLeaf: LayoutNode = { type: 'leaf', terminalId: 't2' };
    const result = splitLeafInTree(leaf, 't1', 'horizontal', newLeaf, 's1');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.direction).toBe('horizontal');
      expect(result.children).toHaveLength(2);
      expect(result.sizes).toEqual([50, 50]);
    }
  });

  it('returns non-matching leaf unchanged', () => {
    const leaf: LayoutNode = { type: 'leaf', terminalId: 't1' };
    const newLeaf: LayoutNode = { type: 'leaf', terminalId: 't2' };
    const result = splitLeafInTree(leaf, 't3', 'horizontal', newLeaf, 's1');
    expect(result).toBe(leaf);
  });
});

// ---------------------------------------------------------------------------
// updateSplitSizes
// ---------------------------------------------------------------------------

describe('updateSplitSizes', () => {
  it('updates sizes on matching split', () => {
    const split: LayoutNode = {
      id: 's1',
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', terminalId: 't1' },
        { type: 'leaf', terminalId: 't2' },
      ],
      sizes: [50, 50],
    };
    const result = updateSplitSizes(split, 's1', [30, 70]);
    expect(result.type === 'split' && result.sizes).toEqual([30, 70]);
  });

  it('returns leaf unchanged', () => {
    const leaf: LayoutNode = { type: 'leaf', terminalId: 't1' };
    expect(updateSplitSizes(leaf, 's1', [50, 50])).toBe(leaf);
  });
});
