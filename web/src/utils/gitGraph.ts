import type { CommitInfo } from '../api/git';

export const LANE_COLORS = [
  '#0085d9', // blue (main branch)
  '#d9008f', // magenta
  '#3fb950', // green
  '#d98500', // orange
  '#a300d9', // purple
  '#56d4dd', // cyan
  '#e05050', // red
  '#00d9a3', // teal
];

export interface Connection {
  fromLane: number;
  toLane: number;
  colorIndex: number;
  type: 'merge-in' | 'branch-out';
}

export interface ActiveLane {
  lane: number;
  colorIndex: number;
}

export interface LaneNode {
  lane: number;
  activeLanes: ActiveLane[];
  connections: Connection[];
  colorIndex: number;
  isMerge: boolean;
  /** Lanes that were newly allocated at this commit (branch-out targets) */
  newLanes: number[];
  /** Whether this commit was expected in a lane (vs newly allocated) */
  wasExpected: boolean;
}

/**
 * Compute lane assignments for a list of commits (newest first).
 *
 * Lane 0 is the main branch and always gets colorIndex 0.
 * Each lane slot holds the hash of the next expected commit. When a commit
 * is processed its first parent inherits the lane (continuous line) while
 * additional parents either merge into existing lanes or open new ones.
 */
export function computeLanes(commits: CommitInfo[]): Map<string, LaneNode> {
  const result = new Map<string, LaneNode>();
  if (commits.length === 0) return result;

  // lanes[i] = hash expected at that lane, or null if free
  const lanes: (string | null)[] = [];
  // track color assignment per lane — lane 0 always gets color 0
  const laneColors: number[] = [];
  // nextColor starts at 1: color 0 is reserved for lane 0 (main branch)
  let nextColor = 1;
  // Track which lane each processed commit occupied (for --all fallback)
  const processedLane = new Map<string, number>();
  const processedColor = new Map<string, number>();

  function allocLane(hash: string): number {
    // reuse first free slot
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) {
        lanes[i] = hash;
        laneColors[i] = i === 0 ? 0 : nextColor++ % LANE_COLORS.length;
        return i;
      }
    }
    const idx = lanes.length;
    lanes.push(hash);
    laneColors[idx] = idx === 0 ? 0 : nextColor++ % LANE_COLORS.length;
    return idx;
  }

  for (const commit of commits) {
    const { hash, parents } = commit;
    const isMerge = parents.length > 1;

    // Find which lane this commit occupies
    const wasExpected = lanes.indexOf(hash) !== -1;
    let myLane = wasExpected ? lanes.indexOf(hash) : allocLane(hash);
    const colorIndex = laneColors[myLane];

    const connections: Connection[] = [];
    const newLanes: number[] = [];

    // Merge duplicate lane entries: when multiple children pointed to this
    // commit, it appears in several lanes. Keep myLane, merge others in.
    for (let i = 0; i < lanes.length; i++) {
      if (i !== myLane && lanes[i] === hash) {
        connections.push({
          fromLane: i,
          toLane: myLane,
          colorIndex: laneColors[i],
          type: 'merge-in',
        });
        lanes[i] = null;
      }
    }

    if (parents.length === 0) {
      // root commit — release lane
      lanes[myLane] = null;
    } else {
      // first parent inherits current lane (continuous line, no explicit connection needed)
      lanes[myLane] = parents[0];

      // additional parents
      for (let p = 1; p < parents.length; p++) {
        const parentHash = parents[p];
        const existingLane = lanes.indexOf(parentHash);
        if (existingLane !== -1) {
          // Parent expected in an active lane — standard merge-in
          // fromLane = branch side, toLane = commit side
          connections.push({
            fromLane: existingLane,
            toLane: myLane,
            colorIndex: laneColors[existingLane],
            type: 'merge-in',
          });
        } else if (processedLane.has(parentHash)) {
          // Parent was already processed (--all interleaving) — merge-in to its historical lane
          const histLane = processedLane.get(parentHash)!;
          const histColor = processedColor.get(parentHash)!;
          connections.push({
            fromLane: histLane,
            toLane: myLane,
            colorIndex: histColor,
            type: 'merge-in',
          });
        } else {
          const newLane = allocLane(parentHash);
          newLanes.push(newLane);
          connections.push({
            fromLane: myLane,
            toLane: newLane,
            colorIndex: laneColors[newLane],
            type: 'branch-out',
          });
        }
      }
    }

    // Collapse trailing nulls
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneColors.pop();
    }

    const activeLanes: ActiveLane[] = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null) activeLanes.push({ lane: i, colorIndex: laneColors[i] });
    }

    processedLane.set(hash, myLane);
    processedColor.set(hash, colorIndex);
    result.set(hash, { lane: myLane, activeLanes, connections, colorIndex, isMerge, newLanes, wasExpected });
  }

  return result;
}
