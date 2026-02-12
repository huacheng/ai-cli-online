import { API_BASE, authHeaders } from './client';

export async function fetchDraft(token: string, sessionId: string): Promise<string> {
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/draft`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) return '';
    const data = await res.json();
    return data.content ?? '';
  } catch (e) {
    console.warn('[drafts] fetchDraft failed:', e);
    return '';
  }
}

export async function saveDraft(token: string, sessionId: string, content: string): Promise<void> {
  try {
    await fetch(
      `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/draft`,
      {
        method: 'PUT',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      },
    );
  } catch (e) {
    console.warn('[drafts] saveDraft failed:', e);
  }
}
