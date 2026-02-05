import { create } from 'zustand';
import type { Message } from './types';

interface AppState {
  // Auth token
  token: string | null;
  setToken: (token: string | null) => void;

  // Connection state
  connected: boolean;
  setConnected: (connected: boolean) => void;

  // Working directory
  workingDir: string;
  setWorkingDir: (dir: string) => void;

  // Messages
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;

  // Loading state
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Error state
  error: string | null;
  setError: (error: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  // Auth token
  token: null,
  setToken: (token) => {
    if (token) {
      localStorage.setItem('cli-online-token', token);
    } else {
      localStorage.removeItem('cli-online-token');
    }
    set({ token });
  },

  // Connection state
  connected: false,
  setConnected: (connected) => set({ connected }),

  // Working directory
  workingDir: '',
  setWorkingDir: (workingDir) => set({ workingDir }),

  // Messages
  messages: [],
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    })),

  // Loading state
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),

  // Error state
  error: null,
  setError: (error) => set({ error }),
}));
