import { sessionApi } from './apiClient';
import type { FileContentResult } from './types';
export type { FileContentResult };

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
  const query: Record<string, string> = { path };
  if (since) query.since = String(since);
  return sessionApi.getOptional<FileContentResult>(token, sessionId, 'file-content', query);
}

/**
 * Save file content (write back to disk).
 * Only works for files under AiTasks/ directories.
 */
export async function saveFileContent(
  token: string,
  sessionId: string,
  path: string,
  content: string,
): Promise<{ ok: boolean; mtime: number }> {
  return sessionApi.putJson<{ ok: boolean; mtime: number }>(token, sessionId, 'file-content', { path, content });
}
