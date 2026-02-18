import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted, so use vi.hoisted for shared state
// ---------------------------------------------------------------------------

const { mockExecFile, mockResolveSession, mockGetCwd } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockResolveSession: vi.fn(() => 'mock-session'),
  mockGetCwd: vi.fn(),
}));

vi.mock('../middleware/auth.js', () => ({
  resolveSession: mockResolveSession,
}));

vi.mock('../tmux.js', () => ({
  getCwd: mockGetCwd,
}));

vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  return {
    ...actual,
    promisify: (fn: Function) => fn.name === 'execFile' ? mockExecFile : actual.promisify(fn),
  };
});

import gitRouter from './git.js';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(gitRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:sessionId/git-log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSession.mockReturnValue('mock-session');
  });

  it('returns 401 when resolveSession fails', async () => {
    mockResolveSession.mockImplementation((_req: any, res: any) => {
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-log');
    expect(res.status).toBe(401);
  });

  it('returns 404 when session/cwd not found', async () => {
    mockGetCwd.mockRejectedValue(new Error('no session'));

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-log');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Session not found');
  });

  it('returns commits on success with parents and refs', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');

    const SEP = '---GIT-LOG-SEP---';
    const gitOutput = [
      `${SEP}`,
      'abc1234567890abcdef1234567890abcdef123456',
      'abc1234',
      'def5678567890abcdef1234567890abcdef567890',
      'HEAD -> master, tag: v1.0, origin/master',
      'Initial commit',
      'TestUser',
      '2024-01-01T00:00:00+00:00',
      '10\t2\tREADME.md',
    ].join('\n');

    mockExecFile.mockResolvedValue({ stdout: gitOutput, stderr: '' });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-log');
    expect(res.status).toBe(200);
    expect(res.body.commits).toHaveLength(1);

    const commit = res.body.commits[0];
    expect(commit).toMatchObject({
      hash: 'abc1234567890abcdef1234567890abcdef123456',
      shortHash: 'abc1234',
      message: 'Initial commit',
      author: 'TestUser',
    });
    expect(commit.parents).toEqual(['def5678567890abcdef1234567890abcdef567890']);
    expect(commit.refs).toEqual([
      { type: 'head', name: 'master' },
      { type: 'tag', name: 'v1.0' },
      { type: 'remote', name: 'origin/master' },
    ]);
    expect(commit.files).toHaveLength(1);
    expect(commit.files[0]).toEqual({
      path: 'README.md',
      additions: 10,
      deletions: 2,
    });
    expect(res.body.hasMore).toBe(false);
  });

  it('parses empty parents and refs', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');

    const SEP = '---GIT-LOG-SEP---';
    const gitOutput = [
      `${SEP}`,
      'abc1234567890abcdef1234567890abcdef123456',
      'abc1234',
      '',       // no parents (root commit)
      '',       // no refs
      'Root commit',
      'TestUser',
      '2024-01-01T00:00:00+00:00',
    ].join('\n');

    mockExecFile.mockResolvedValue({ stdout: gitOutput, stderr: '' });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-log');
    expect(res.status).toBe(200);
    expect(res.body.commits).toHaveLength(1);
    expect(res.body.commits[0].parents).toEqual([]);
    expect(res.body.commits[0].refs).toEqual([]);
  });

  it('parses merge commit with multiple parents', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');

    const SEP = '---GIT-LOG-SEP---';
    const gitOutput = [
      `${SEP}`,
      'merge123456789012345678901234567890123456',
      'merge12',
      'parent1a2b3c4d5e6f7890123456789012345678 parent2a2b3c4d5e6f7890123456789012345678',
      '',
      'Merge branch feature',
      'TestUser',
      '2024-01-01T00:00:00+00:00',
    ].join('\n');

    mockExecFile.mockResolvedValue({ stdout: gitOutput, stderr: '' });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-log');
    expect(res.status).toBe(200);
    expect(res.body.commits[0].parents).toEqual([
      'parent1a2b3c4d5e6f7890123456789012345678',
      'parent2a2b3c4d5e6f7890123456789012345678',
    ]);
  });

  it('returns empty for non-git repository', async () => {
    mockGetCwd.mockResolvedValue('/tmp');
    mockExecFile.mockRejectedValue(new Error('fatal: not a git repository'));

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-log');
    expect(res.status).toBe(200);
    expect(res.body.commits).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.error).toBe('Not a git repository');
  });

  it('supports file filter query param', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

    const app = createApp();
    await request(app).get('/api/sessions/t1/git-log?file=src/index.ts');

    expect(mockExecFile).toHaveBeenCalled();
    const callArgs = mockExecFile.mock.calls[0];
    const args = callArgs[1] as string[];
    expect(args).toContain('--');
    expect(args).toContain('src/index.ts');
  });

  it('supports --all query param', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

    const app = createApp();
    await request(app).get('/api/sessions/t1/git-log?all=true');

    expect(mockExecFile).toHaveBeenCalled();
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain('--all');
  });

  it('does not include --all when not requested', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');
    mockExecFile.mockResolvedValue({ stdout: '', stderr: '' });

    const app = createApp();
    await request(app).get('/api/sessions/t1/git-log');

    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).not.toContain('--all');
  });

  it('supports pagination and hasMore', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');

    const SEP = '---GIT-LOG-SEP---';
    const gitOutput = [
      `${SEP}`, 'hash1', 'sh1', 'parent1', '', 'msg1', 'Author', '2024-01-01T00:00:00+00:00',
      `${SEP}`, 'hash2', 'sh2', 'parent2', '', 'msg2', 'Author', '2024-01-02T00:00:00+00:00',
    ].join('\n');

    mockExecFile.mockResolvedValue({ stdout: gitOutput, stderr: '' });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-log?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.commits).toHaveLength(1);
    expect(res.body.hasMore).toBe(true);
  });
});

describe('GET /api/sessions/:sessionId/git-diff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSession.mockReturnValue('mock-session');
  });

  it('returns 400 for missing commit', async () => {
    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-diff');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid commit hash');
  });

  it('returns 400 for invalid commit hash', async () => {
    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-diff?commit=ZZZZ');
    expect(res.status).toBe(400);
  });

  it('returns diff on success', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');

    const diffOutput = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3`;

    mockExecFile
      .mockResolvedValueOnce({ stdout: 'parenthash', stderr: '' })
      .mockResolvedValueOnce({ stdout: diffOutput, stderr: '' });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-diff?commit=abc1234');
    expect(res.status).toBe(200);
    expect(res.body.diff).toContain('+added line');
  });

  it('passes file filter to diff', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'parenthash', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'diff output', stderr: '' });

    const app = createApp();
    await request(app).get('/api/sessions/t1/git-diff?commit=abc1234&file=src/main.ts');

    const diffCall = mockExecFile.mock.calls[1];
    const args = diffCall[1] as string[];
    expect(args).toContain('--');
    expect(args).toContain('src/main.ts');
  });

  it('returns 500 on unexpected git error', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');
    mockExecFile
      .mockResolvedValueOnce({ stdout: 'parenthash', stderr: '' })
      .mockRejectedValueOnce(new Error('git process killed'));

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-diff?commit=abc1234');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to get diff');
  });

  it('handles root commit fallback', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');

    mockExecFile
      .mockRejectedValueOnce(new Error('unknown revision'))
      .mockResolvedValueOnce({ stdout: 'root diff output', stderr: '' });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-diff?commit=abc1234');
    expect(res.status).toBe(200);
    expect(res.body.diff).toBe('root diff output');

    const secondCall = mockExecFile.mock.calls[1];
    const args = secondCall[1] as string[];
    expect(args).toContain('--root');
  });
});

describe('GET /api/sessions/:sessionId/git-branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSession.mockReturnValue('mock-session');
  });

  it('returns branches and current branch', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');
    mockExecFile.mockResolvedValue({
      stdout: '  feature-a\n* master\n  remotes/origin/master\n',
      stderr: '',
    });

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-branches');
    expect(res.status).toBe(200);
    expect(res.body.current).toBe('master');
    expect(res.body.branches).toContain('master');
    expect(res.body.branches).toContain('feature-a');
    expect(res.body.branches).toContain('remotes/origin/master');
  });

  it('returns empty for non-git repository', async () => {
    mockGetCwd.mockResolvedValue('/tmp');
    mockExecFile.mockRejectedValue(new Error('fatal: not a git repository'));

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-branches');
    expect(res.status).toBe(200);
    expect(res.body.current).toBe('');
    expect(res.body.branches).toEqual([]);
  });

  it('returns 404 when session not found', async () => {
    mockGetCwd.mockRejectedValue(new Error('no session'));

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/git-branches');
    expect(res.status).toBe(404);
  });
});
