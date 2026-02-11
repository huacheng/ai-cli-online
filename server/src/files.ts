import { readdir, stat, realpath } from 'fs/promises';
import { join, resolve } from 'path';
import type { FileEntry } from './types.js';

export type { FileEntry };

export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
export const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

export interface ListFilesResult {
  files: FileEntry[];
  truncated: boolean;
}

const MAX_DIR_ENTRIES = 1000;

/** List files in a directory, directories first, then alphabetical */
export async function listFiles(dirPath: string): Promise<ListFilesResult> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  // Batched parallel stat to avoid excessive concurrent syscalls on large directories
  const BATCH_SIZE = 50;
  const results: FileEntry[] = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(async (entry) => {
        const fullPath = join(dirPath, entry.name);
        const s = await stat(fullPath);
        return {
          name: entry.name,
          type: (entry.isDirectory() ? 'directory' : 'file') as FileEntry['type'],
          size: s.size,
          modifiedAt: s.mtime.toISOString(),
        };
      }),
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') results.push(result.value);
    }
  }

  // Directories first, then alphabetical
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Cap entries to prevent excessive memory/bandwidth usage on huge directories
  const truncated = results.length > MAX_DIR_ENTRIES;
  return { files: truncated ? results.slice(0, MAX_DIR_ENTRIES) : results, truncated };
}

/**
 * Validate and resolve a requested path against a base CWD.
 * Returns the resolved absolute path, or null if invalid.
 *
 * Since users already have full shell access, this mainly prevents
 * REST API path traversal via encoded sequences like `../../../etc/passwd`.
 * We resolve the path and ensure it's an absolute path that exists.
 */
export async function validatePath(requested: string, baseCwd: string): Promise<string | null> {
  try {
    const resolved = resolve(baseCwd, requested);
    const real = await realpath(resolved);
    // Containment check: ensure resolved path is within baseCwd
    const realBase = await realpath(baseCwd);
    if (real !== realBase && !real.startsWith(realBase + '/')) {
      return null;
    }
    return real;
  } catch {
    return null;
  }
}

/** Validate a path that may not exist yet (for touch/mkdir). Uses realpath on baseCwd only. */
export async function validateNewPath(requested: string, baseCwd: string): Promise<string | null> {
  try {
    const realBase = await realpath(baseCwd);
    const resolved = resolve(realBase, requested);
    if (resolved !== realBase && !resolved.startsWith(realBase + '/')) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}
