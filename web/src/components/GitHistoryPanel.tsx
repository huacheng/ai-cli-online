import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { useStore } from '../store';
import { fetchGitLog, fetchGitDiff } from '../api/git';
import type { CommitInfo } from '../api/git';

interface GitHistoryPanelProps {
  sessionId: string;
  token: string;
}

/** Format ISO date to relative time */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// DiffView — renders unified diff with red/green line backgrounds
// ---------------------------------------------------------------------------

function DiffView({ diff, fontSize }: { diff: string; fontSize: number }) {
  if (!diff.trim()) {
    return <div style={{ padding: 8, color: 'var(--text-secondary)', fontSize }}>No diff available</div>;
  }

  const hunks: { header: string; lines: { type: string; text: string }[] }[] = [];
  let currentHunk: typeof hunks[0] | null = null;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      currentHunk = { header: raw, lines: [] };
      hunks.push(currentHunk);
    } else if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('---') || raw.startsWith('+++')) {
      // skip diff headers
    } else if (currentHunk) {
      let type = 'context';
      if (raw.startsWith('+')) type = 'add';
      else if (raw.startsWith('-')) type = 'del';
      currentHunk.lines.push({ type, text: raw });
    }
  }

  return (
    <div style={{ fontSize, fontFamily: "'JetBrains Mono', monospace", overflow: 'auto' }}>
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div style={{
            padding: '2px 8px',
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
                padding: '0 8px',
                whiteSpace: 'pre',
                backgroundColor:
                  line.type === 'add' ? 'rgba(63, 185, 80, 0.12)' :
                  line.type === 'del' ? 'rgba(248, 81, 73, 0.12)' : 'transparent',
                color:
                  line.type === 'add' ? 'var(--accent-green)' :
                  line.type === 'del' ? 'var(--accent-red)' : 'var(--text-primary)',
              }}
            >
              {line.text}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitItem — single commit row with expandable file list
// ---------------------------------------------------------------------------

function CommitItem({ commit, sessionId, token, fontSize }: { commit: CommitInfo; sessionId: string; token: string; fontSize: number }) {
  const [expanded, setExpanded] = useState(false);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>('');
  const [loadingDiff, setLoadingDiff] = useState(false);

  const handleFileClick = useCallback(async (filePath: string) => {
    if (diffFile === filePath) {
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
  }, [sessionId, token, commit.hash, diffFile]);

  const totalAdd = commit.files.reduce((s, f) => s + f.additions, 0);
  const totalDel = commit.files.reduce((s, f) => s + f.deletions, 0);
  const smSize = fontSize - 2;
  const xsSize = fontSize - 4;

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '6px 10px',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: smSize, color: 'var(--accent-yellow)', fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
            {commit.shortHash}
          </span>
          <span style={{
            fontSize,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}>
            {commit.message}
          </span>
          <span style={{ fontSize: xsSize, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {expanded ? '\u25BC' : '\u25B6'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: smSize, color: 'var(--text-secondary)' }}>
          <span>{commit.author}</span>
          <span>{relativeTime(commit.date)}</span>
          {commit.files.length > 0 && (
            <span>
              <span style={{ color: 'var(--accent-green)' }}>+{totalAdd}</span>
              {' '}
              <span style={{ color: 'var(--accent-red)' }}>-{totalDel}</span>
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 10px 6px', marginLeft: 10 }}>
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
}

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
  const debounceRef = useRef<number>(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(async (p: number, file: string, append: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchGitLog(sessionId, token, { page: p, file: file || undefined });
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

  // Initial load and reload on search change
  useEffect(() => {
    loadPage(1, search, false);
  }, [search, loadPage]);

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
    if (!loading && hasMore) loadPage(page + 1, search, true);
  }, [loading, hasMore, page, search, loadPage]);

  // Scroll-to-bottom load more
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
      handleLoadMore();
    }
  }, [loading, hasMore, handleLoadMore]);

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
        <span style={{ fontSize: smSize, color: 'var(--accent-purple)', fontWeight: 500, flexShrink: 0 }}>Git</span>
        <input
          type="text"
          value={searchInput}
          onChange={handleSearchChange}
          placeholder="Filter by file path..."
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
          <CommitItem key={c.hash} commit={c} sessionId={sessionId} token={token} fontSize={fontSize} />
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
