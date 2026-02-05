import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Conversation, Message } from './types.js';

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), 'data');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

const CONVERSATIONS_FILE = join(DATA_DIR, 'conversations.json');
const CONFIG_FILE = join(DATA_DIR, 'config.json');

interface StorageData {
  conversations: Record<string, Conversation>;
}

interface ConfigData {
  currentConversationId: string | null;
  workingDir: string;
}

function loadData(): StorageData {
  if (!existsSync(CONVERSATIONS_FILE)) {
    return { conversations: {} };
  }
  try {
    const data = readFileSync(CONVERSATIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { conversations: {} };
  }
}

function saveData(data: StorageData): void {
  writeFileSync(CONVERSATIONS_FILE, JSON.stringify(data, null, 2));
}

function loadConfig(): ConfigData {
  const defaultConfig: ConfigData = {
    currentConversationId: null,
    workingDir: process.env.DEFAULT_WORKING_DIR || process.env.HOME || '/home/ubuntu',
  };

  if (!existsSync(CONFIG_FILE)) {
    return defaultConfig;
  }
  try {
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    return { ...defaultConfig, ...JSON.parse(data) };
  } catch {
    return defaultConfig;
  }
}

function saveConfig(config: ConfigData): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export class Storage {
  private data: StorageData;
  private config: ConfigData;

  constructor() {
    this.data = loadData();
    this.config = loadConfig();
  }

  // Config methods
  getWorkingDir(): string {
    return this.config.workingDir;
  }

  setWorkingDir(dir: string): void {
    this.config.workingDir = dir;
    saveConfig(this.config);
  }

  getCurrentConversationId(): string | null {
    return this.config.currentConversationId;
  }

  setCurrentConversationId(id: string | null): void {
    this.config.currentConversationId = id;
    saveConfig(this.config);
  }

  // Conversation methods
  createConversation(id: string): Conversation {
    const conversation: Conversation = {
      id,
      workingDir: this.config.workingDir,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.conversations[id] = conversation;
    this.config.currentConversationId = id;
    saveData(this.data);
    saveConfig(this.config);
    return conversation;
  }

  getConversation(id: string): Conversation | null {
    return this.data.conversations[id] || null;
  }

  getCurrentConversation(): Conversation | null {
    if (!this.config.currentConversationId) {
      return null;
    }
    return this.getConversation(this.config.currentConversationId);
  }

  getAllConversations(): Conversation[] {
    return Object.values(this.data.conversations).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  addMessage(conversationId: string, message: Message): void {
    const conversation = this.data.conversations[conversationId];
    if (conversation) {
      conversation.messages.push(message);
      conversation.updatedAt = Date.now();
      saveData(this.data);
    }
  }

  updateMessage(conversationId: string, messageId: string, updates: Partial<Message>): void {
    const conversation = this.data.conversations[conversationId];
    if (conversation) {
      const messageIndex = conversation.messages.findIndex((m) => m.id === messageId);
      if (messageIndex !== -1) {
        conversation.messages[messageIndex] = {
          ...conversation.messages[messageIndex],
          ...updates,
        };
        conversation.updatedAt = Date.now();
        saveData(this.data);
      }
    }
  }

  updateConversationWorkingDir(conversationId: string, workingDir: string): void {
    const conversation = this.data.conversations[conversationId];
    if (conversation) {
      conversation.workingDir = workingDir;
      conversation.updatedAt = Date.now();
      saveData(this.data);
    }
  }

  getConversationWorkingDir(conversationId: string): string {
    const conversation = this.data.conversations[conversationId];
    return conversation?.workingDir || this.config.workingDir;
  }

  setClaudeSessionId(conversationId: string, sessionId: string): void {
    const conversation = this.data.conversations[conversationId];
    if (conversation) {
      conversation.claudeSessionId = sessionId;
      conversation.updatedAt = Date.now();
      saveData(this.data);
    }
  }

  getClaudeSessionId(conversationId: string): string | undefined {
    const conversation = this.data.conversations[conversationId];
    return conversation?.claudeSessionId;
  }

  deleteConversation(id: string): void {
    delete this.data.conversations[id];
    if (this.config.currentConversationId === id) {
      this.config.currentConversationId = null;
    }
    saveData(this.data);
    saveConfig(this.config);
  }
}

// Singleton instance
export const storage = new Storage();
