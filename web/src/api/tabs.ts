import { API_BASE } from './client';
import { settingsApi } from './apiClient';
import type { TabsLayoutResponse } from './types';
import type { PersistedTabsState } from '../types';

export async function fetchTabsLayout(token: string): Promise<PersistedTabsState | null> {
  try {
    const data = await settingsApi.get<TabsLayoutResponse>(token, 'tabs-layout');
    return data.layout;
  } catch {
    return null;
  }
}

export async function saveTabsLayout(token: string, layout: PersistedTabsState): Promise<void> {
  try {
    await settingsApi.put(token, 'tabs-layout', { layout });
  } catch {
    // ignore save errors
  }
}

export function saveTabsLayoutBeacon(token: string, layout: PersistedTabsState): void {
  try {
    const url = `${API_BASE}/api/settings/tabs-layout`;
    const body = JSON.stringify({ layout, token });
    navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
  } catch {
    // ignore beacon errors
  }
}
