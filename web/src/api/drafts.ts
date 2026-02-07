import { API_BASE, authHeaders } from './client';

export async function fetchDraft(token: string, sessionId: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/draft`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) return '';
  const data = await res.json();
  return data.content ?? '';
}

export async function saveDraft(token: string, sessionId: string, content: string): Promise<void> {
  await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/draft`,
    {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
}
