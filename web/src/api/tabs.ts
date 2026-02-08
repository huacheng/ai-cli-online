import { API_BASE, authHeaders } from './client';
import type { PersistedTabsState } from '../types';

export async function fetchTabsLayout(token: string): Promise<PersistedTabsState | null> {
  try {
    const res = await fetch(`${API_BASE}/api/settings/tabs-layout`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return null;
    const data: { layout: PersistedTabsState | null } = await res.json();
    return data.layout;
  } catch {
    return null;
  }
}

export async function saveTabsLayout(token: string, layout: PersistedTabsState): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/settings/tabs-layout`, {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout }),
    });
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
    // best-effort
  }
}
