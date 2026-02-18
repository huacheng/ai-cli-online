import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./apiClient', () => ({
  sessionApi: {
    get: vi.fn(),
  },
}));

import { fetchGitLog, fetchGitDiff, fetchGitBranches } from './git';
import { sessionApi } from './apiClient';

const mockGet = vi.mocked(sessionApi.get);

describe('fetchGitLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls sessionApi.get with correct path', async () => {
    const response = { commits: [], hasMore: false };
    mockGet.mockResolvedValue(response);

    const result = await fetchGitLog('t1', 'token123');
    expect(mockGet).toHaveBeenCalledWith('token123', 't1', 'git-log', {});
    expect(result).toEqual(response);
  });

  it('passes query params when provided', async () => {
    mockGet.mockResolvedValue({ commits: [], hasMore: false });

    await fetchGitLog('t1', 'token123', { page: 2, limit: 10, file: 'src/index.ts' });
    expect(mockGet).toHaveBeenCalledWith('token123', 't1', 'git-log', {
      page: '2',
      limit: '10',
      file: 'src/index.ts',
    });
  });

  it('omits falsy query params', async () => {
    mockGet.mockResolvedValue({ commits: [], hasMore: false });

    await fetchGitLog('t1', 'token123', { page: 0, limit: 0 });
    expect(mockGet).toHaveBeenCalledWith('token123', 't1', 'git-log', {});
  });

  it('passes all=true query param', async () => {
    mockGet.mockResolvedValue({ commits: [], hasMore: false });

    await fetchGitLog('t1', 'token123', { all: true });
    expect(mockGet).toHaveBeenCalledWith('token123', 't1', 'git-log', { all: 'true' });
  });
});

describe('fetchGitBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls sessionApi.get with correct path', async () => {
    const response = { current: 'master', branches: ['master', 'feature-a'] };
    mockGet.mockResolvedValue(response);

    const result = await fetchGitBranches('t1', 'token123');
    expect(mockGet).toHaveBeenCalledWith('token123', 't1', 'git-branches');
    expect(result).toEqual(response);
  });
});

describe('fetchGitDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns diff string from response', async () => {
    mockGet.mockResolvedValue({ diff: '+ added line' });

    const result = await fetchGitDiff('t1', 'token123', 'abc1234');
    expect(result).toBe('+ added line');
    expect(mockGet).toHaveBeenCalledWith('token123', 't1', 'git-diff', { commit: 'abc1234' });
  });

  it('passes optional file param', async () => {
    mockGet.mockResolvedValue({ diff: '' });

    await fetchGitDiff('t1', 'token123', 'abc1234', 'src/main.ts');
    expect(mockGet).toHaveBeenCalledWith('token123', 't1', 'git-diff', {
      commit: 'abc1234',
      file: 'src/main.ts',
    });
  });
});
