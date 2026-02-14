import { API_BASE, authHeaders } from './client';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function sessionUrl(sessionId: string, path: string): string {
  return `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/${path}`;
}

function settingsUrl(path: string): string {
  return `${API_BASE}/api/settings/${path}`;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }
  return res.json();
}

/** Typed API client for session-scoped endpoints */
export const sessionApi = {
  async get<T>(token: string, sessionId: string, path: string, query?: Record<string, string>): Promise<T> {
    const url = new URL(sessionUrl(sessionId, path), window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), { headers: authHeaders(token) });
    return parseResponse<T>(res);
  },

  /** GET that returns null on 304 */
  async getOptional<T>(token: string, sessionId: string, path: string, query?: Record<string, string>): Promise<T | null> {
    const url = new URL(sessionUrl(sessionId, path), window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), { headers: authHeaders(token) });
    if (res.status === 304) return null;
    return parseResponse<T>(res);
  },

  async post<T>(token: string, sessionId: string, path: string, body: unknown): Promise<T> {
    const res = await fetch(sessionUrl(sessionId, path), {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseResponse<T>(res);
  },

  async put(token: string, sessionId: string, path: string, body: unknown): Promise<void> {
    const res = await fetch(sessionUrl(sessionId, path), {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ApiError(res.status, text);
    }
  },

  async putJson<T>(token: string, sessionId: string, path: string, body: unknown): Promise<T> {
    const res = await fetch(sessionUrl(sessionId, path), {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return parseResponse<T>(res);
  },

  async del(token: string, sessionId: string, path: string, body?: unknown): Promise<void> {
    const res = await fetch(sessionUrl(sessionId, path), {
      method: 'DELETE',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ApiError(res.status, text);
    }
  },

  /** Raw fetch for blob downloads */
  async getBlob(token: string, sessionId: string, path: string, query?: Record<string, string>): Promise<Response> {
    const url = new URL(sessionUrl(sessionId, path), window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), { headers: authHeaders(token) });
    if (!res.ok) throw new ApiError(res.status, 'Download failed');
    return res;
  },
};

/** Typed API client for global settings endpoints */
export const settingsApi = {
  async get<T>(token: string, path: string): Promise<T> {
    const res = await fetch(settingsUrl(path), { headers: authHeaders(token) });
    return parseResponse<T>(res);
  },

  async put(token: string, path: string, body: unknown): Promise<void> {
    const res = await fetch(settingsUrl(path), {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ApiError(res.status, text);
    }
  },
};
