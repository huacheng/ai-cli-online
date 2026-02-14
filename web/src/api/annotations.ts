import { API_BASE, authHeaders } from './client';

export async function fetchAnnotation(
  token: string,
  sessionId: string,
  filePath: string,
): Promise<{ content: string; updatedAt: number } | null> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/annotations?path=${encodeURIComponent(filePath)}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error('Failed to fetch annotation');
  const data = await res.json();
  return data.content ? { content: data.content, updatedAt: data.updatedAt } : null;
}

export async function saveAnnotationRemote(
  token: string,
  sessionId: string,
  filePath: string,
  content: string,
  updatedAt: number,
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/annotations`,
    {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content, updatedAt }),
    },
  );
  if (!res.ok) throw new Error('Failed to save annotation');
}

export async function writeTaskAnnotations(
  token: string,
  sessionId: string,
  modulePath: string,
  content: object,
): Promise<{ path: string }> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/task-annotations`,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ modulePath, content }),
    },
  );
  if (!res.ok) throw new Error('Failed to write task annotations');
  return res.json();
}

