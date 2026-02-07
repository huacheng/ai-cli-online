import { API_BASE, authHeaders } from './client';

export interface PlanFileInfo {
  name: string;
  content: string;
  mtime: number;
}

export async function fetchPaneCommand(token: string, sessionId: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/pane-command`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return '';
  const data = await res.json();
  return data.command ?? '';
}

export async function fetchLatestPlan(
  token: string,
  sessionId: string,
  since?: number,
): Promise<PlanFileInfo | null> {
  const url = since
    ? `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/plan/latest?since=${since}`
    : `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/plan/latest`;
  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 304) return null; // unchanged
  if (!res.ok) return null;
  const data = await res.json();
  return data.plan ?? null;
}

export async function savePlanFile(
  token: string,
  sessionId: string,
  filename: string,
  content: string,
): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/plan/save-file`,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content }),
    },
  );
  if (!res.ok) throw new Error('Failed to save plan file');
  const data = await res.json();
  return data.path;
}
