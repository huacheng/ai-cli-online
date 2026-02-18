import { sessionApi } from './apiClient';

export interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface RefInfo {
  type: 'head' | 'branch' | 'remote' | 'tag';
  name: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: RefInfo[];
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

interface GitDiffResponse {
  diff: string;
}

interface GitBranchesResponse {
  current: string;
  branches: string[];
}

export async function fetchGitLog(
  sessionId: string,
  token: string,
  opts: { page?: number; limit?: number; file?: string; all?: boolean; branch?: string } = {},
): Promise<GitLogResponse> {
  const query: Record<string, string> = {};
  if (opts.page) query.page = String(opts.page);
  if (opts.limit) query.limit = String(opts.limit);
  if (opts.file) query.file = opts.file;
  if (opts.all) query.all = 'true';
  if (opts.branch) query.branch = opts.branch;

  return sessionApi.get<GitLogResponse>(token, sessionId, 'git-log', query);
}

export async function fetchGitDiff(
  sessionId: string,
  token: string,
  commit: string,
  file?: string,
): Promise<string> {
  const query: Record<string, string> = { commit };
  if (file) query.file = file;

  const data = await sessionApi.get<GitDiffResponse>(token, sessionId, 'git-diff', query);
  return data.diff;
}

export async function fetchGitBranches(
  sessionId: string,
  token: string,
): Promise<GitBranchesResponse> {
  return sessionApi.get<GitBranchesResponse>(token, sessionId, 'git-branches');
}
