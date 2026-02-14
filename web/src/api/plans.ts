import { sessionApi } from './apiClient';
import type { PaneCommandResponse } from './types';

export async function fetchPaneCommand(token: string, sessionId: string): Promise<string> {
  try {
    const data = await sessionApi.get<PaneCommandResponse>(token, sessionId, 'pane-command');
    return data.command ?? '';
  } catch {
    return '';
  }
}
