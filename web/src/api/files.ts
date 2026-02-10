import type { FileEntry } from 'ai-cli-online-shared';
import { API_BASE, authHeaders } from './client';

export type { FileEntry };

export interface FilesResponse {
  cwd: string;
  files: FileEntry[];
}

export async function fetchFiles(token: string, sessionId: string, path?: string): Promise<FilesResponse> {
  const params = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/files${params}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error('Failed to list files');
  return res.json();
}

export function uploadFiles(
  token: string,
  sessionId: string,
  files: FileList | File[],
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.send(formData);
  });
}

export async function fetchCwd(token: string, sessionId: string): Promise<string> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/cwd`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error('Failed to fetch cwd');
  const data = await res.json();
  return data.cwd;
}

export async function touchFile(token: string, sessionId: string, name: string): Promise<{ ok: boolean; path: string; existed?: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/touch`,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw new Error('Failed to create file');
  return res.json();
}

export async function downloadFile(token: string, sessionId: string, filePath: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/download?path=${encodeURIComponent(filePath)}`,
    { headers: authHeaders(token) },
  );
  if (!res.ok) throw new Error('Download failed');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Extract filename from path
  a.download = filePath.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
