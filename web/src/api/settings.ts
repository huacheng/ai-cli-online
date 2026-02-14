import { settingsApi } from './apiClient';
import type { FontSizeResponse } from './types';

export async function fetchFontSize(token: string): Promise<number> {
  try {
    const data = await settingsApi.get<FontSizeResponse>(token, 'font-size');
    return data.fontSize;
  } catch {
    return 14;
  }
}

export async function saveFontSize(token: string, size: number): Promise<void> {
  try {
    await settingsApi.put(token, 'font-size', { fontSize: size });
  } catch {
    // ignore save errors
  }
}
