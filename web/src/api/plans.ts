import { API_BASE, authHeaders } from './client';

export async function fetchPaneCommand(token: string, sessionId: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/pane-command`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return '';
  const data = await res.json();
  return data.command ?? '';
}
