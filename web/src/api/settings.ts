import { API_BASE, authHeaders } from './client';

export async function fetchFontSize(token: string): Promise<number> {
  try {
    const res = await fetch(`${API_BASE}/api/settings/font-size`, {
      headers: authHeaders(token),
    });
    if (!res.ok) return 14;
    const data: { fontSize: number } = await res.json();
    return data.fontSize;
  } catch {
    return 14;
  }
}

export async function saveFontSize(token: string, size: number): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/settings/font-size`, {
      method: 'PUT',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fontSize: size }),
    });
  } catch {
    // ignore save errors
  }
}
