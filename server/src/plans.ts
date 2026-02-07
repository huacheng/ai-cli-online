import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { homedir } from 'os';

const PLANS_DIR = join(homedir(), '.claude', 'plans');

export interface PlanFileInfo {
  name: string;
  content: string;
  mtime: number; // ms timestamp
}

interface PlanEntry {
  name: string;
  mtime: number;
  filePath: string;
}

/** Find the most recently modified .md file in the plans directory */
async function findLatestPlanEntry(): Promise<PlanEntry | null> {
  const entries = await readdir(PLANS_DIR);
  const mdFiles = entries.filter((f) => extname(f).toLowerCase() === '.md');
  if (mdFiles.length === 0) return null;

  const stats = await Promise.all(
    mdFiles.map(async (name) => {
      const filePath = join(PLANS_DIR, name);
      const s = await stat(filePath);
      return { name, mtime: s.mtimeMs, filePath };
    }),
  );
  stats.sort((a, b) => b.mtime - a.mtime);
  return stats[0];
}

export async function getLatestPlanFile(): Promise<PlanFileInfo | null> {
  try {
    const latest = await findLatestPlanEntry();
    if (!latest) return null;
    const content = await readFile(latest.filePath, 'utf-8');
    return { name: latest.name, content, mtime: latest.mtime };
  } catch {
    return null;
  }
}

export async function getLatestPlanIfChanged(
  knownMtime: number,
): Promise<PlanFileInfo | null | 'unchanged'> {
  try {
    const latest = await findLatestPlanEntry();
    if (!latest) return null;
    if (latest.mtime <= knownMtime) return 'unchanged';
    const content = await readFile(latest.filePath, 'utf-8');
    return { name: latest.name, content, mtime: latest.mtime };
  } catch {
    return null;
  }
}
