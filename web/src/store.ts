import { create } from 'zustand';

interface AppState {
  token: string | null;
  setToken: (token: string | null) => void;

  connected: boolean;
  setConnected: (connected: boolean) => void;

  sessionResumed: boolean;
  setSessionResumed: (resumed: boolean) => void;

  error: string | null;
  setError: (error: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  token: null,
  setToken: (token) => {
    if (token) {
      localStorage.setItem('cli-online-token', token);
    } else {
      localStorage.removeItem('cli-online-token');
    }
    set({ token });
  },

  connected: false,
  setConnected: (connected) => set({ connected }),

  sessionResumed: false,
  setSessionResumed: (sessionResumed) => set({ sessionResumed }),

  error: null,
  setError: (error) => set({ error }),
}));
