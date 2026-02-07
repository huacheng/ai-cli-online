import { readdir, readFile, stat, open } from 'fs/promises';
import { join, extname } from 'path';
import { homedir } from 'os';

const PLANS_DIR = join(homedir(), '.claude', 'plans');

// Cache: projectKey → { slug, jsonlMtime }
const slugCache = new Map<string, { slug: string; jsonlMtime: number }>();

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

/** Extract plan slug from the tail of a JSONL file (reads at most 64KB) */
async function extractPlanSlugFromFile(filepath: string): Promise<string | null> {
  const fd = await open(filepath, 'r');
  try {
    const s = await fd.stat();
    const readSize = Math.min(s.size, 64 * 1024);
    const buffer = Buffer.alloc(readSize);
    await fd.read(buffer, 0, readSize, Math.max(0, s.size - readSize));
    const content = buffer.toString('utf-8');
    const matches = [...content.matchAll(/\.claude\/plans\/([\w-]+)\.md/g)];
    return matches.length > 0 ? matches[matches.length - 1][1] : null;
  } finally {
    await fd.close();
  }
}

/** Build a PlanEntry from a known plan slug */
async function planEntryFromSlug(slug: string): Promise<PlanEntry | null> {
  const filePath = join(PLANS_DIR, `${slug}.md`);
  try {
    const s = await stat(filePath);
    return { name: `${slug}.md`, mtime: s.mtimeMs, filePath };
  } catch {
    return null;
  }
}

/** Find the plan file associated with a specific project CWD via JSONL references */
async function findPlanForCwd(cwd: string): Promise<PlanEntry | null> {
  const projectKey = cwd.replace(/\//g, '-');
  const projectDir = join(homedir(), '.claude', 'projects', projectKey);

  let jsonlFiles: { name: string; mtime: number; path: string }[];
  try {
    const entries = await readdir(projectDir);
    const jsonls = entries.filter(f => f.endsWith('.jsonl'));
    jsonlFiles = await Promise.all(
      jsonls.map(async (name) => {
        const fp = join(projectDir, name);
        const s = await stat(fp);
        return { name, mtime: s.mtimeMs, path: fp };
      }),
    );
    jsonlFiles.sort((a, b) => b.mtime - a.mtime);
  } catch {
    return null;
  }

  if (jsonlFiles.length === 0) return null;
  const latestJsonl = jsonlFiles[0];

  // Check cache — skip I/O if JSONL hasn't changed
  const cached = slugCache.get(projectKey);
  if (cached && cached.jsonlMtime >= latestJsonl.mtime) {
    return planEntryFromSlug(cached.slug);
  }

  const slug = await extractPlanSlugFromFile(latestJsonl.path);
  if (!slug) return null;

  slugCache.set(projectKey, { slug, jsonlMtime: latestJsonl.mtime });
  return planEntryFromSlug(slug);
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

export async function getLatestPlanFile(cwd?: string): Promise<PlanFileInfo | null> {
  try {
    const latest = cwd
      ? (await findPlanForCwd(cwd)) ?? (await findLatestPlanEntry())
      : await findLatestPlanEntry();
    if (!latest) return null;
    const content = await readFile(latest.filePath, 'utf-8');
    return { name: latest.name, content, mtime: latest.mtime };
  } catch {
    return null;
  }
}

export async function getLatestPlanIfChanged(
  knownMtime: number,
  cwd?: string,
): Promise<PlanFileInfo | null | 'unchanged'> {
  try {
    const latest = cwd
      ? (await findPlanForCwd(cwd)) ?? (await findLatestPlanEntry())
      : await findLatestPlanEntry();
    if (!latest) return null;
    if (latest.mtime <= knownMtime) return 'unchanged';
    const content = await readFile(latest.filePath, 'utf-8');
    return { name: latest.name, content, mtime: latest.mtime };
  } catch {
    return null;
  }
}
