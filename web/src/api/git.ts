import { API_BASE, authHeaders } from './client';

export interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  files: CommitFile[];
}

export interface GitLogResponse {
  commits: CommitInfo[];
  hasMore: boolean;
  error?: string;
}

export async function fetchGitLog(
  sessionId: string,
  token: string,
  opts: { page?: number; limit?: number; file?: string } = {},
): Promise<GitLogResponse> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.file) params.set('file', opts.file);

  const qs = params.toString();
  const url = `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/git-log${qs ? `?${qs}` : ''}`;
  const resp = await fetch(url, { headers: authHeaders(token) });
  if (!resp.ok) throw new Error(`git-log failed: ${resp.status}`);
  return resp.json();
}

export async function fetchGitDiff(
  sessionId: string,
  token: string,
  commit: string,
  file?: string,
): Promise<string> {
  const params = new URLSearchParams({ commit });
  if (file) params.set('file', file);

  const url = `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/git-diff?${params}`;
  const resp = await fetch(url, { headers: authHeaders(token) });
  if (!resp.ok) throw new Error(`git-diff failed: ${resp.status}`);
  const data = await resp.json();
  return data.diff;
}
