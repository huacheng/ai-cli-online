import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useStore } from '../store';
import { fetchGitLog, fetchGitDiff, fetchGitBranches } from '../api/git';
import type { CommitInfo, RefInfo } from '../api/git';
import { computeLanes, LANE_COLORS } from '../utils/gitGraph';
import type { LaneNode, Connection } from '../utils/gitGraph';

interface GitHistoryPanelProps {
  sessionId: string;
  token: string;
}

/** Format ISO date to compact relative time */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

// ---------------------------------------------------------------------------
// GraphCell — renders lane graph as inline SVG (Git Graph rounded-corner style)
// ---------------------------------------------------------------------------

const LANE_WIDTH = 20;
const ROW_HEIGHT = 32;
const NODE_R = 4;
const MERGE_R = 5;
const CY = ROW_HEIGHT / 2;

function laneX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function colorOf(idx: number): string {
  return LANE_COLORS[idx % LANE_COLORS.length];
}

/** Build an SVG path — smooth cubic Bézier (Git Graph style) */
function connectionPath(conn: Connection): string {
  if (conn.type === 'branch-out') {
    // From commit lane (CY) curving down to new branch lane (ROW_HEIGHT)
    const x1 = laneX(conn.fromLane);
    const x2 = laneX(conn.toLane);
    if (x1 === x2) return `M ${x1} ${CY} L ${x1} ${ROW_HEIGHT}`;
    const d = (ROW_HEIGHT - CY) * 0.8;
    return `M ${x1} ${CY} C ${x1} ${CY + d}, ${x2} ${ROW_HEIGHT - d}, ${x2} ${ROW_HEIGHT}`;
  } else {
    // merge-in: From branch lane (top=0) curving into commit lane (CY)
    const x1 = laneX(conn.fromLane); // branch side
    const x2 = laneX(conn.toLane);   // commit side
    if (x1 === x2) return `M ${x1} 0 L ${x1} ${CY}`;
    const d = CY * 0.8;
    return `M ${x1} 0 C ${x1} ${d}, ${x2} ${CY - d}, ${x2} ${CY}`;
  }
}

const GraphCell = memo(function GraphCell({ laneNode, maxLanes }: { laneNode: LaneNode; maxLanes: number }) {
  const width = maxLanes * LANE_WIDTH;
  const newSet = laneNode.newLanes;

  return (
    <svg width={width} height={ROW_HEIGHT} style={{ flexShrink: 0, display: 'block' }}>
      {/* Active lane vertical lines — skip top portion for newly branched lanes */}
      {laneNode.activeLanes.map((al) => {
        const isNew = newSet.includes(al.lane);
        if (isNew) return null; // connection path draws the visual for new lanes
        return (
          <line
            key={`active-${al.lane}`}
            x1={laneX(al.lane)}
            y1={0}
            x2={laneX(al.lane)}
            y2={ROW_HEIGHT}
            stroke={colorOf(al.colorIndex)}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}

      {/* Connections — smooth cubic Bézier curves */}
      {laneNode.connections.map((conn, i) => (
        <path
          key={`conn-${i}`}
          d={connectionPath(conn)}
          stroke={colorOf(conn.colorIndex)}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
        />
      ))}

      {/* Stem line: connect from row above to commit dot when lane was released (e.g. root commits) */}
      {laneNode.wasExpected &&
       !laneNode.activeLanes.some(al => al.lane === laneNode.lane) &&
       !newSet.includes(laneNode.lane) && (
        <line
          x1={laneX(laneNode.lane)}
          y1={0}
          x2={laneX(laneNode.lane)}
          y2={CY}
          stroke={colorOf(laneNode.colorIndex)}
          strokeWidth={2}
          strokeLinecap="round"
        />
      )}

      {/* Node dot */}
      {laneNode.isMerge ? (
        <circle
          cx={laneX(laneNode.lane)}
          cy={CY}
          r={MERGE_R}
          fill="var(--bg-primary)"
          stroke={colorOf(laneNode.colorIndex)}
          strokeWidth={2}
        />
      ) : (
        <circle
          cx={laneX(laneNode.lane)}
          cy={CY}
          r={NODE_R}
          fill={colorOf(laneNode.colorIndex)}
        />
      )}
    </svg>
  );
});

// ---------------------------------------------------------------------------
// RefBadges — renders branch/tag/HEAD labels
// ---------------------------------------------------------------------------

const REF_STYLES: Record<RefInfo['type'], { bg: string; color: string }> = {
  head:   { bg: 'var(--accent-red)',    color: '#fff' },
  branch: { bg: 'var(--accent-blue)',   color: '#fff' },
  remote: { bg: 'var(--accent-purple)', color: '#fff' },
  tag:    { bg: 'var(--accent-green)',  color: '#fff' },
};

function RefBadges({ refs, fontSize }: { refs: RefInfo[]; fontSize: number }) {
  if (refs.length === 0) return null;
  const badgeSize = fontSize - 4;
  return (
    <>
      {refs.map((ref, i) => {
        const style = REF_STYLES[ref.type];
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              padding: '0 4px',
              borderRadius: 3,
              fontSize: badgeSize,
              lineHeight: `${badgeSize + 6}px`,
              backgroundColor: style.bg,
              color: style.color,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {ref.type === 'head' && ref.name !== 'HEAD' ? `HEAD \u2192 ${ref.name}` : ref.name}
          </span>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// DiffView — renders unified diff with red/green line backgrounds
// ---------------------------------------------------------------------------

interface DiffLine {
  type: string;
  text: string;
  oldNum: number | null;
  newNum: number | null;
}

function parseHunkHeader(header: string): [number, number] {
  const m = header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [1, 1];
}

const DiffView = memo(function DiffView({ diff, fontSize }: { diff: string; fontSize: number }) {
  if (!diff.trim()) {
    return <div style={{ padding: 8, color: 'var(--text-secondary)', fontSize }}>No diff available</div>;
  }

  const hunks: { header: string; lines: DiffLine[] }[] = [];
  let currentHunk: typeof hunks[0] | null = null;
  let oldLine = 1;
  let newLine = 1;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      const [o, n] = parseHunkHeader(raw);
      oldLine = o;
      newLine = n;
      currentHunk = { header: raw, lines: [] };
      hunks.push(currentHunk);
    } else if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('---') || raw.startsWith('+++')) {
      // skip diff headers
    } else if (currentHunk) {
      if (raw.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', text: raw, oldNum: null, newNum: newLine++ });
      } else if (raw.startsWith('-')) {
        currentHunk.lines.push({ type: 'del', text: raw, oldNum: oldLine++, newNum: null });
      } else {
        currentHunk.lines.push({ type: 'context', text: raw, oldNum: oldLine++, newNum: newLine++ });
      }
    }
  }

  const lnWidth = fontSize * 2.6;

  return (
    <div style={{ fontSize, fontFamily: "'JetBrains Mono', monospace", overflow: 'auto' }}>
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div style={{
            padding: '2px 8px',
            paddingLeft: lnWidth * 2 + 12,
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--accent-cyan)',
            fontSize: fontSize - 1,
            borderTop: hi > 0 ? '1px solid var(--border)' : undefined,
          }}>
            {hunk.header}
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              style={{
                display: 'flex',
                whiteSpace: 'pre',
                backgroundColor:
                  line.type === 'add' ? 'rgba(63, 185, 80, 0.12)' :
                  line.type === 'del' ? 'rgba(248, 81, 73, 0.12)' : 'transparent',
              }}
            >
              <span style={{
                display: 'inline-block',
                width: lnWidth,
                textAlign: 'right',
                paddingRight: 4,
                color: 'var(--text-secondary)',
                opacity: 0.5,
                flexShrink: 0,
                userSelect: 'none',
              }}>
                {line.oldNum ?? ''}
              </span>
              <span style={{
                display: 'inline-block',
                width: lnWidth,
                textAlign: 'right',
                paddingRight: 6,
                color: 'var(--text-secondary)',
                opacity: 0.5,
                flexShrink: 0,
                userSelect: 'none',
                borderRight: '1px solid var(--border)',
                marginRight: 6,
              }}>
                {line.newNum ?? ''}
              </span>
              <span style={{
                flex: 1,
                color:
                  line.type === 'add' ? 'var(--accent-green)' :
                  line.type === 'del' ? 'var(--accent-red)' : 'var(--text-primary)',
              }}>
                {line.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

// ---------------------------------------------------------------------------
// CommitItem — single commit row with graph, refs, and expandable file list
// ---------------------------------------------------------------------------

const CommitItem = memo(function CommitItem({
  commit, sessionId, token, fontSize, laneNode, maxLanes,
}: {
  commit: CommitInfo;
  sessionId: string;
  token: string;
  fontSize: number;
  laneNode: LaneNode | undefined;
  maxLanes: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>('');
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [copied, setCopied] = useState(false);
  const diffFileRef = useRef(diffFile);
  diffFileRef.current = diffFile;

  const handleFileClick = useCallback(async (filePath: string) => {
    if (diffFileRef.current === filePath) {
      setDiffFile(null);
      return;
    }
    setDiffFile(filePath);
    setLoadingDiff(true);
    try {
      const d = await fetchGitDiff(sessionId, token, commit.hash, filePath);
      setDiffContent(d);
    } catch {
      setDiffContent('Failed to load diff');
    } finally {
      setLoadingDiff(false);
    }
  }, [sessionId, token, commit.hash]);

  const smSize = fontSize - 2;
  const xsSize = fontSize - 4;
  const graphWidth = maxLanes * LANE_WIDTH;

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '2px 8px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          height: ROW_HEIGHT,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        {/* Graph cell */}
        {laneNode && maxLanes > 0 && (
          <GraphCell laneNode={laneNode} maxLanes={maxLanes} />
        )}

        {/* Commit info — single row */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefBadges refs={commit.refs} fontSize={fontSize} />
          <span style={{
            fontSize: smSize,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}>
            {commit.message}
          </span>
          <span style={{ fontSize: xsSize, color: 'var(--text-secondary)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {commit.author.split(' ')[0]} · {relativeTime(commit.date)}
          </span>
          <span
            title="Click to copy full hash"
            style={{ fontSize: xsSize, color: copied ? 'var(--accent-green)' : 'var(--accent-yellow)', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, opacity: copied ? 1 : 0.6, cursor: 'pointer', transition: 'color 0.2s, opacity 0.2s' }}
            onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(commit.hash).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          >
            {copied ? 'Copied' : commit.shortHash}
          </span>
          <span style={{ fontSize: xsSize, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {expanded ? '\u25BC' : '\u25B6'}
          </span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 10px 6px', marginLeft: graphWidth + 10 }}>
          {commit.files.length === 0 ? (
            <div style={{ fontSize: smSize, color: 'var(--text-secondary)', padding: '4px 0' }}>No files changed</div>
          ) : (
            commit.files.map((f) => (
              <div key={f.path}>
                <div
                  onClick={() => handleFileClick(f.path)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '2px 4px',
                    cursor: 'pointer',
                    fontSize,
                    borderRadius: 3,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <span style={{
                    fontSize: xsSize,
                    color: 'var(--accent-green)',
                    fontFamily: "'JetBrains Mono', monospace",
                    minWidth: 28,
                    textAlign: 'right',
                  }}>
                    +{f.additions}
                  </span>
                  <span style={{
                    fontSize: xsSize,
                    color: 'var(--accent-red)',
                    fontFamily: "'JetBrains Mono', monospace",
                    minWidth: 28,
                    textAlign: 'right',
                  }}>
                    -{f.deletions}
                  </span>
                  <span style={{
                    color: diffFile === f.path ? 'var(--accent-blue)' : 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    direction: 'rtl',
                    textAlign: 'left',
                    flex: 1,
                  }}>
                    {f.path}
                  </span>
                </div>
                {diffFile === f.path && (
                  <div style={{
                    margin: '2px 0 4px',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    overflow: 'hidden',
                    maxHeight: 400,
                    overflowY: 'auto',
                  }}>
                    {loadingDiff ? (
                      <div style={{ padding: 8, color: 'var(--text-secondary)', fontSize }}>Loading...</div>
                    ) : (
                      <DiffView diff={diffContent} fontSize={fontSize} />
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// GitHistoryPanel — main component
// ---------------------------------------------------------------------------

export const GitHistoryPanel = memo(function GitHistoryPanel({ sessionId, token }: GitHistoryPanelProps) {
  const fontSize = useStore((s) => s.fontSize);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [allBranches, setAllBranches] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const debounceRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch branch list
  useEffect(() => {
    fetchGitBranches(sessionId, token)
      .then(({ current, branches: list }) => {
        setCurrentBranch(current);
        setBranches(list);
      })
      .catch(() => {});
  }, [sessionId, token]);

  const loadPage = useCallback(async (p: number, file: string, append: boolean, all: boolean, branch: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchGitLog(sessionId, token, {
        page: p,
        file: file || undefined,
        all: all || undefined,
        branch: branch || undefined,
      });
      if (resp.error) setError(resp.error);
      setCommits((prev) => append ? [...prev, ...resp.commits] : resp.commits);
      setHasMore(resp.hasMore);
      setPage(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [sessionId, token]);

  // Initial load and reload on search/allBranches/selectedBranch change
  useEffect(() => {
    loadPage(1, search, false, allBranches, selectedBranch);
  }, [search, allBranches, selectedBranch, loadPage]);

  // Debounced search
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => setSearch(val), 300);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleLoadMore = useCallback(() => {
    if (!loading && hasMore) loadPage(page + 1, search, true, allBranches, selectedBranch);
  }, [loading, hasMore, page, search, allBranches, selectedBranch, loadPage]);

  // Scroll-to-bottom load more (rAF throttled)
  const rafRef = useRef(0);
  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollRef.current;
      if (!el || loading || !hasMore) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
        handleLoadMore();
      }
    });
  }, [loading, hasMore, handleLoadMore]);

  useEffect(() => {
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Lane computation
  const laneMap = useMemo(() => computeLanes(commits), [commits]);
  const maxLanes = useMemo(() => {
    let max = 0;
    for (const node of laneMap.values()) {
      let nodeLanes = node.lane + 1;
      for (let i = 0; i < node.activeLanes.length; i++) {
        const v = node.activeLanes[i].lane + 1;
        if (v > nodeLanes) nodeLanes = v;
      }
      if (nodeLanes > max) max = nodeLanes;
    }
    return Math.min(max, 15);
  }, [laneMap]);

  const smSize = fontSize - 2;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--bg-primary)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '4px 8px',
        gap: 6,
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
        flexShrink: 0,
      }}>
        <select
          value={allBranches ? '__all__' : selectedBranch}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__all__') {
              setAllBranches(true);
              setSelectedBranch('');
            } else {
              setAllBranches(false);
              setSelectedBranch(v);
            }
          }}
          style={{
            fontSize: smSize,
            padding: '1px 2px',
            border: '1px solid var(--border)',
            borderRadius: 3,
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            outline: 'none',
            flexShrink: 0,
            maxWidth: 130,
          }}
          title="Select branch"
        >
          <option value="">{currentBranch || 'HEAD'}</option>
          {branches
            .filter((b) => b !== currentBranch)
            .map((b) => <option key={b} value={b}>{b}</option>)}
          <option value="__all__">-- All branches --</option>
        </select>
        <input
          type="text"
          value={searchInput}
          onChange={handleSearchChange}
          placeholder="Filter by file..."
          style={{
            flex: 1,
            fontSize: smSize,
            padding: '2px 6px',
            border: '1px solid var(--border)',
            borderRadius: 3,
            backgroundColor: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            outline: 'none',
            minWidth: 0,
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '4px 8px', fontSize: smSize, color: 'var(--accent-red)', backgroundColor: 'var(--bg-secondary)' }}>
          {error}
        </div>
      )}

      {/* Commit list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
      >
        {commits.map((c) => (
          <CommitItem
            key={c.hash}
            commit={c}
            sessionId={sessionId}
            token={token}
            fontSize={fontSize}
            laneNode={laneMap.get(c.hash)}
            maxLanes={maxLanes}
          />
        ))}

        {loading && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-secondary)', fontSize }}>
            Loading...
          </div>
        )}

        {!loading && commits.length === 0 && !error && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-secondary)', fontSize }}>
            No commits found
          </div>
        )}

        {!loading && hasMore && (
          <div style={{ padding: 8, textAlign: 'center' }}>
            <button
              className="pane-btn"
              onClick={handleLoadMore}
              style={{ fontSize: smSize }}
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
