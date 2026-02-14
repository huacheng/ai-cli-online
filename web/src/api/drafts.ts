import { sessionApi } from './apiClient';
import type { DraftResponse } from './types';

export async function fetchDraft(token: string, sessionId: string): Promise<string> {
  try {
    const data = await sessionApi.get<DraftResponse>(token, sessionId, 'draft');
    return data.content ?? '';
  } catch {
    return '';
  }
}

export async function saveDraft(token: string, sessionId: string, content: string): Promise<void> {
  try {
    await sessionApi.put(token, sessionId, 'draft', { content });
  } catch {
    // ignore save errors
  }
}
