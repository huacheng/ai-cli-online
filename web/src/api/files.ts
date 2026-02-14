import { API_BASE } from './client';
import { sessionApi } from './apiClient';
import type { FilesResponse, TouchResponse, MkdirResponse } from './types';
export type { FileEntry } from './types';
export type { FilesResponse };

export async function fetchFiles(token: string, sessionId: string, path?: string): Promise<FilesResponse> {
  const query = path ? { path } : undefined;
  return sessionApi.get<FilesResponse>(token, sessionId, 'files', query);
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
  const data = await sessionApi.get<{ cwd: string }>(token, sessionId, 'cwd');
  return data.cwd;
}

export async function touchFile(token: string, sessionId: string, name: string): Promise<TouchResponse> {
  return sessionApi.post<TouchResponse>(token, sessionId, 'touch', { name });
}

export async function mkdirPath(token: string, sessionId: string, path: string): Promise<MkdirResponse> {
  return sessionApi.post<MkdirResponse>(token, sessionId, 'mkdir', { path });
}

export async function deleteItem(token: string, sessionId: string, path: string): Promise<void> {
  return sessionApi.del(token, sessionId, 'rm', { path });
}

export async function downloadCwd(token: string, sessionId: string): Promise<void> {
  const res = await sessionApi.getBlob(token, sessionId, 'download-cwd');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const disposition = res.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="(.+)"/);
  a.download = match ? decodeURIComponent(match[1]) : 'cwd.tar.gz';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadFile(token: string, sessionId: string, filePath: string): Promise<void> {
  const res = await sessionApi.getBlob(token, sessionId, 'download', { path: filePath });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filePath.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
