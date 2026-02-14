import type { StateCreator } from 'zustand';
import type { ServerSession } from '../types';
import { saveFontSize } from '../api/settings';
import { API_BASE, authHeaders } from '../api/client';
import type { AppState, SettingsSlice } from './types';

let fontSizeTimer: ReturnType<typeof setTimeout> | null = null;

export const createSettingsSlice: StateCreator<AppState, [], [], SettingsSlice> = (set, get) => ({
  // --- Font size --------------------------------------------------------------

  fontSize: 14,

  setFontSize: (size) => {
    const clamped = Math.max(10, Math.min(24, size));
    set({ fontSize: clamped });
    if (fontSizeTimer) clearTimeout(fontSizeTimer);
    fontSizeTimer = setTimeout(() => {
      fontSizeTimer = null;
      const token = get().token;
      if (token) {
        saveFontSize(token, clamped);
      }
    }, 500);
  },

  // --- Network ----------------------------------------------------------------

  latency: null,
  setLatency: (latency) => set({ latency }),

  // --- Theme ------------------------------------------------------------------

  theme: (() => {
    try {
      const saved = localStorage.getItem('ai-cli-online-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return 'dark';
  })() as 'dark' | 'light',

  setTheme: (theme) => {
    set({ theme });
    try { localStorage.setItem('ai-cli-online-theme', theme); } catch { /* ignore */ }
    document.documentElement.setAttribute('data-theme', theme);
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },

  // --- Sidebar ----------------------------------------------------------------

  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  serverSessions: [],

  fetchSessions: async () => {
    const token = get().token;
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        headers: authHeaders(token),
      });
      if (!res.ok) return;
      const data: ServerSession[] = await res.json();
      set({ serverSessions: data });
    } catch {
      // ignore fetch errors
    }
  },
});
