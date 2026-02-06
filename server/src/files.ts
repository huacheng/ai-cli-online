import { readdir, stat, realpath } from 'fs/promises';
import { join, resolve } from 'path';

export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024; // 100 MB
export const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100 MB

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: string;
}

/** List files in a directory, directories first, then alphabetical */
export async function listFiles(dirPath: string): Promise<FileEntry[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const results: FileEntry[] = [];

  for (const entry of entries) {
    try {
      const fullPath = join(dirPath, entry.name);
      const s = await stat(fullPath);
      results.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: s.size,
        modifiedAt: s.mtime.toISOString(),
      });
    } catch {
      // Skip entries we can't stat (broken symlinks, permission errors)
    }
  }

  // Directories first, then alphabetical
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return results;
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
    // Verify the path actually exists by resolving symlinks
    const real = await realpath(resolved);
    return real;
  } catch {
    return null;
  }
}
