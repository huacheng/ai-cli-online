import type { FileEntry } from 'ai-cli-online-shared';

export type { FileEntry };

// --- Files API ---

export interface FilesResponse {
  cwd: string;
  home?: string;
  files: FileEntry[];
}

export interface TouchResponse {
  ok: boolean;
  path: string;
  existed?: boolean;
}

export interface MkdirResponse {
  ok: boolean;
  path: string;
}

// --- Docs API ---

export interface FileContentResult {
  content: string;
  mtime: number;
  size: number;
  encoding: 'utf-8' | 'base64';
}

// --- Drafts API ---

export interface DraftResponse {
  content: string;
}

// --- Annotations API ---

export interface AnnotationRemote {
  content: string;
  updatedAt: number;
}

export interface TaskAnnotationResult {
  path: string;
}

// --- Settings API ---

export interface FontSizeResponse {
  fontSize: number;
}

export interface TabsLayoutResponse {
  layout: import('../types').PersistedTabsState | null;
}

// --- Plans API ---

export interface PaneCommandResponse {
  command: string;
}
