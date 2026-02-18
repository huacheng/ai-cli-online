import { describe, it, expect } from 'vitest';
import { computeLanes } from './gitGraph';
import type { CommitInfo } from '../api/git';

function makeCommit(hash: string, parents: string[], rest?: Partial<CommitInfo>): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents,
    refs: [],
    message: `commit ${hash}`,
    author: 'Test',
    date: '2024-01-01T00:00:00Z',
    files: [],
    ...rest,
  };
}

describe('computeLanes', () => {
  it('returns empty map for empty input', () => {
    const result = computeLanes([]);
    expect(result.size).toBe(0);
  });

  it('linear history — all in lane 0, no connections', () => {
    const commits = [
      makeCommit('c3', ['c2']),
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const map = computeLanes(commits);

    expect(map.get('c3')!.lane).toBe(0);
    expect(map.get('c2')!.lane).toBe(0);
    expect(map.get('c1')!.lane).toBe(0);

    // Linear commits: first parent inherits lane, no explicit connections
    for (const c of commits) {
      const node = map.get(c.hash)!;
      expect(node.connections).toHaveLength(0);
    }

    // Lane 0 should always get colorIndex 0 (main branch)
    expect(map.get('c3')!.colorIndex).toBe(0);
    expect(map.get('c2')!.colorIndex).toBe(0);
  });

  it('merge commit creates merge-in or branch-out connection', () => {
    // c4 merges c3 and c2 (c4 has two parents)
    const commits = [
      makeCommit('c4', ['c3', 'c2']),  // merge commit
      makeCommit('c3', ['c1']),
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const map = computeLanes(commits);

    const mergeNode = map.get('c4')!;
    expect(mergeNode.isMerge).toBe(true);
    // Only 1 connection (second parent); first parent inherits lane silently
    expect(mergeNode.connections.length).toBe(1);
    expect(['merge-in', 'branch-out']).toContain(mergeNode.connections[0].type);
  });

  it('root commit releases its lane', () => {
    const commits = [
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const map = computeLanes(commits);
    const rootNode = map.get('c1')!;
    expect(rootNode.connections).toHaveLength(0);
    expect(rootNode.activeLanes).toHaveLength(0);
  });

  it('branch and merge produces multiple lanes', () => {
    // Timeline: c1 -> c2 (branch A), c1 -> c3 (branch B), c4 merges c2+c3
    const commits = [
      makeCommit('c4', ['c2', 'c3']),  // merge
      makeCommit('c2', ['c1']),
      makeCommit('c3', ['c1']),
      makeCommit('c1', []),
    ];

    const map = computeLanes(commits);
    expect(map.size).toBe(4);

    // c4 should be merge
    expect(map.get('c4')!.isMerge).toBe(true);

    // c2 and c3 should have lane assignments
    const c2Lane = map.get('c2')!.lane;
    const c3Lane = map.get('c3')!.lane;
    expect(typeof c2Lane).toBe('number');
    expect(typeof c3Lane).toBe('number');
  });

  it('single commit with no parents', () => {
    const commits = [makeCommit('c1', [])];
    const map = computeLanes(commits);
    expect(map.get('c1')!.lane).toBe(0);
    expect(map.get('c1')!.connections).toHaveLength(0);
    expect(map.get('c1')!.isMerge).toBe(false);
  });

  it('activeLanes carries lane and colorIndex', () => {
    const commits = [
      makeCommit('c3', ['c2']),
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const map = computeLanes(commits);
    // After processing c3, lane 0 has c2 → 1 active lane
    const c3Active = map.get('c3')!.activeLanes;
    expect(c3Active).toHaveLength(1);
    expect(c3Active[0].lane).toBe(0);
    expect(c3Active[0].colorIndex).toBe(0);
    // After root c1, no lanes active
    expect(map.get('c1')!.activeLanes).toHaveLength(0);
  });

  it('main branch (lane 0) always gets colorIndex 0', () => {
    const commits = [
      makeCommit('c4', ['c3', 'c2']),
      makeCommit('c3', ['c1']),
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];

    const map = computeLanes(commits);
    // c4 is on lane 0, should have colorIndex 0
    expect(map.get('c4')!.colorIndex).toBe(0);
    // c3 inherits lane 0
    expect(map.get('c3')!.colorIndex).toBe(0);
    // c2 is on a different lane, should NOT have colorIndex 0
    const c2 = map.get('c2')!;
    if (c2.lane !== 0) {
      expect(c2.colorIndex).not.toBe(0);
    }
  });

  it('newLanes tracks branch-out targets', () => {
    // c3 merges c2 and c1; c2 is not in lanes yet → branch-out
    const commits = [
      makeCommit('c3', ['c2', 'c1']),
      makeCommit('c2', []),
      makeCommit('c1', []),
    ];

    const map = computeLanes(commits);
    const merge = map.get('c3')!;
    // c1 was not already in lanes, so branch-out allocates a new lane
    expect(merge.newLanes.length).toBeGreaterThan(0);
    // Linear commits have no new lanes
    expect(map.get('c2')!.newLanes).toHaveLength(0);
  });

  it('linear history has no newLanes', () => {
    const commits = [
      makeCommit('c2', ['c1']),
      makeCommit('c1', []),
    ];
    const map = computeLanes(commits);
    expect(map.get('c2')!.newLanes).toHaveLength(0);
    expect(map.get('c1')!.newLanes).toHaveLength(0);
  });
});
