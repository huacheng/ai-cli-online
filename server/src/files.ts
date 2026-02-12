import { readdir, stat, lstat, realpath } from 'fs/promises';
import { join, resolve } from 'path';
import type { FileEntry } from './types.js';

export type { FileEntry };

export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
export const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

/* ── realpath cache (C3) ── */
const realpathCache = new Map<string, { value: string; expiresAt: number }>();
const REALPATH_CACHE_TTL = 5000; // 5s
const REALPATH_CACHE_MAX = 100;

async function cachedRealpath(p: string): Promise<string> {
  const now = Date.now();
  const cached = realpathCache.get(p);
  if (cached && now < cached.expiresAt) return cached.value;
  const real = await realpath(p);
  if (realpathCache.size >= REALPATH_CACHE_MAX) {
    // Evict oldest entry
    const first = realpathCache.keys().next().value;
    if (first !== undefined) realpathCache.delete(first);
  }
  realpathCache.set(p, { value: real, expiresAt: now + REALPATH_CACHE_TTL });
  return real;
}

/* ── Path containment helper (B3) ── */
function isContainedIn(path: string, base: string): boolean {
  return path === base || path.startsWith(base + '/');
}

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
    const realBase = await cachedRealpath(baseCwd);
    if (!isContainedIn(real, realBase)) return null;
    return real;
  } catch {
    return null;
  }
}

/**
 * Validate path and reject symlinks (A1).
 * Used for download/file-content/stream-file to prevent symlink traversal.
 */
export async function validatePathNoSymlink(requested: string, baseCwd: string): Promise<string | null> {
  const resolved = await validatePath(requested, baseCwd);
  if (!resolved) return null;
  try {
    const s = await lstat(resolved);
    if (s.isSymbolicLink()) return null;
    return resolved;
  } catch {
    return null;
  }
}

/** Validate a path that may not exist yet (for touch/mkdir). Uses realpath on baseCwd only. */
export async function validateNewPath(requested: string, baseCwd: string): Promise<string | null> {
  try {
    const realBase = await cachedRealpath(baseCwd);
    const resolved = resolve(realBase, requested);
    if (!isContainedIn(resolved, realBase)) return null;
    return resolved;
  } catch {
    return null;
  }
}
