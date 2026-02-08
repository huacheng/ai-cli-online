import { API_BASE, authHeaders } from './client';

export interface FileContentResult {
  content: string;
  mtime: number;
  size: number;
  encoding: 'utf-8' | 'base64';
}

/**
 * Fetch file content for the document browser.
 * Returns null on 304 (unchanged since `since`).
 */
export async function fetchFileContent(
  token: string,
  sessionId: string,
  path: string,
  since?: number,
): Promise<FileContentResult | null> {
  const params = new URLSearchParams({ path });
  if (since) params.set('since', String(since));
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/file-content?${params}`,
    { headers: authHeaders(token) },
  );
  if (res.status === 304) return null;
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.json();
}
