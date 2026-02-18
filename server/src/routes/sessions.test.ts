import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted, so use vi.hoisted for shared state
// ---------------------------------------------------------------------------

const {
  mockExtractToken,
  mockCheckAuth,
  mockResolveSession,
  mockListSessions,
  mockKillSession,
  mockBuildSessionName,
  mockGetCwd,
  mockGetPaneCommand,
  mockIsValidSessionId,
  mockGetActiveSessionNames,
  mockDeleteDraft,
} = vi.hoisted(() => ({
  mockExtractToken: vi.fn(() => 'test-token'),
  mockCheckAuth: vi.fn(() => true),
  mockResolveSession: vi.fn(() => 'mock-session'),
  mockListSessions: vi.fn(),
  mockKillSession: vi.fn(),
  mockBuildSessionName: vi.fn((_token: string, sessionId: string) => `mock_${sessionId}`),
  mockGetCwd: vi.fn(),
  mockGetPaneCommand: vi.fn(),
  mockIsValidSessionId: vi.fn((id: string) => /^[\w-]+$/.test(id)),
  mockGetActiveSessionNames: vi.fn(() => new Set(['mock_t1'])),
  mockDeleteDraft: vi.fn(),
}));

vi.mock('../middleware/auth.js', () => ({
  extractToken: mockExtractToken,
  checkAuth: mockCheckAuth,
  resolveSession: mockResolveSession,
}));

vi.mock('../tmux.js', () => ({
  listSessions: mockListSessions,
  killSession: mockKillSession,
  buildSessionName: mockBuildSessionName,
  getCwd: mockGetCwd,
  getPaneCommand: mockGetPaneCommand,
  isValidSessionId: mockIsValidSessionId,
}));

vi.mock('../websocket.js', () => ({
  getActiveSessionNames: mockGetActiveSessionNames,
}));

vi.mock('../db.js', () => ({
  deleteDraft: mockDeleteDraft,
}));

import sessionsRouter from './sessions.js';

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(sessionsRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAuth.mockReturnValue(true);
  });

  it('returns 401 when auth fails', async () => {
    mockCheckAuth.mockImplementation((_req: any, res: any) => {
      res.status(401).json({ error: 'Unauthorized' });
      return false;
    });

    const app = createApp();
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(401);
  });

  it('returns sessions with active status', async () => {
    mockListSessions.mockResolvedValue([
      { sessionId: 't1', sessionName: 'mock_t1', createdAt: 1000 },
      { sessionId: 't2', sessionName: 'mock_t2', createdAt: 2000 },
    ]);

    const app = createApp();
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      sessionId: 't1',
      sessionName: 'mock_t1',
      active: true,
    });
    expect(res.body[1]).toMatchObject({
      sessionId: 't2',
      active: false,
    });
  });
});

describe('DELETE /api/sessions/:sessionId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckAuth.mockReturnValue(true);
    mockKillSession.mockResolvedValue(undefined);
  });

  it('returns 400 for invalid sessionId', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/sessions/invalid!id');
    expect(res.status).toBe(400);
  });

  it('kills session and deletes draft', async () => {
    const app = createApp();
    const res = await request(app).delete('/api/sessions/t1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockKillSession).toHaveBeenCalledWith('mock_t1');
    expect(mockDeleteDraft).toHaveBeenCalledWith('mock_t1');
  });
});

describe('GET /api/sessions/:sessionId/cwd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSession.mockReturnValue('mock-session');
  });

  it('returns cwd on success', async () => {
    mockGetCwd.mockResolvedValue('/home/user/project');

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/cwd');
    expect(res.status).toBe(200);
    expect(res.body.cwd).toBe('/home/user/project');
  });

  it('returns 404 when session not found', async () => {
    mockGetCwd.mockRejectedValue(new Error('session not found'));

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/cwd');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/sessions/:sessionId/pane-command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveSession.mockReturnValue('mock-session');
  });

  it('returns command on success', async () => {
    mockGetPaneCommand.mockResolvedValue('claude');

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/pane-command');
    expect(res.status).toBe(200);
    expect(res.body.command).toBe('claude');
  });

  it('returns empty string on error', async () => {
    mockGetPaneCommand.mockRejectedValue(new Error('fail'));

    const app = createApp();
    const res = await request(app).get('/api/sessions/t1/pane-command');
    expect(res.status).toBe(200);
    expect(res.body.command).toBe('');
  });
});
