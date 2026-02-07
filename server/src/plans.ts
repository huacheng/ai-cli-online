import { readdir, readFile, stat, open } from 'fs/promises';
import { join, extname } from 'path';
import { homedir } from 'os';

const CLAUDE_DIR = join(homedir(), '.claude');
const PLANS_DIR = join(CLAUDE_DIR, 'plans');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const PLAN_PATH_RE = /\.claude\/plans\/([\w-]+)\.md/g;
const TAIL_READ_SIZE = 64 * 1024; // 64KB

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
async function extractPlanSlug(filepath: string): Promise<string | null> {
  const fd = await open(filepath, 'r');
  try {
    const s = await fd.stat();
    const readSize = Math.min(s.size, TAIL_READ_SIZE);
    const buffer = Buffer.alloc(readSize);
    await fd.read(buffer, 0, readSize, Math.max(0, s.size - readSize));
    const tail = buffer.toString('utf-8');
    // Find last occurrence — plan references near EOF are most relevant
    let last: string | null = null;
    for (const m of tail.matchAll(PLAN_PATH_RE)) last = m[1];
    return last;
  } finally {
    await fd.close();
  }
}

/** Stat a plan file by slug, returning null if it doesn't exist */
async function planEntryFromSlug(slug: string): Promise<PlanEntry | null> {
  const filePath = join(PLANS_DIR, `${slug}.md`);
  try {
    const s = await stat(filePath);
    return { name: `${slug}.md`, mtime: s.mtimeMs, filePath };
  } catch {
    return null;
  }
}

/** Find the most recently modified file in a directory matching a filter */
async function findLatestFile(
  dir: string,
  filter: (name: string) => boolean,
): Promise<{ name: string; mtime: number; path: string } | null> {
  const entries = await readdir(dir);
  const matched = entries.filter(filter);
  if (matched.length === 0) return null;

  let best: { name: string; mtime: number; path: string } | null = null;
  await Promise.all(
    matched.map(async (name) => {
      const fp = join(dir, name);
      const s = await stat(fp);
      if (!best || s.mtimeMs > best.mtime) {
        best = { name, mtime: s.mtimeMs, path: fp };
      }
    }),
  );
  return best;
}

/** Find the plan file associated with a specific project CWD via JSONL references */
async function findPlanForCwd(cwd: string): Promise<PlanEntry | null> {
  const projectKey = cwd.replace(/\//g, '-');
  const projectDir = join(PROJECTS_DIR, projectKey);

  let latestJsonl: { name: string; mtime: number; path: string } | null;
  try {
    latestJsonl = await findLatestFile(projectDir, f => f.endsWith('.jsonl'));
  } catch {
    return null;
  }
  if (!latestJsonl) return null;

  // Check cache — skip I/O if JSONL hasn't changed
  const cached = slugCache.get(projectKey);
  if (cached && cached.jsonlMtime >= latestJsonl.mtime) {
    return planEntryFromSlug(cached.slug);
  }

  const slug = await extractPlanSlug(latestJsonl.path);
  if (!slug) return null;

  slugCache.set(projectKey, { slug, jsonlMtime: latestJsonl.mtime });
  return planEntryFromSlug(slug);
}

/** Find the most recently modified .md file in the global plans directory */
async function findLatestGlobalPlan(): Promise<PlanEntry | null> {
  const result = await findLatestFile(PLANS_DIR, f => extname(f).toLowerCase() === '.md');
  return result ? { name: result.name, mtime: result.mtime, filePath: result.path } : null;
}

/** Resolve plan entry: CWD-scoped first, fallback to global latest */
async function findPlanEntry(cwd?: string): Promise<PlanEntry | null> {
  if (cwd) {
    const entry = await findPlanForCwd(cwd);
    if (entry) return entry;
  }
  return findLatestGlobalPlan();
}

export async function getLatestPlanFile(cwd?: string): Promise<PlanFileInfo | null> {
  try {
    const latest = await findPlanEntry(cwd);
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
    const latest = await findPlanEntry(cwd);
    if (!latest) return null;
    if (latest.mtime <= knownMtime) return 'unchanged';
    const content = await readFile(latest.filePath, 'utf-8');
    return { name: latest.name, content, mtime: latest.mtime };
  } catch {
    return null;
  }
}
