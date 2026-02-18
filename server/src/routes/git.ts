import { Router } from 'express';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { resolveSession } from '../middleware/auth.js';
import { getCwd } from '../tmux.js';

const execFile = promisify(execFileCb);
const EXEC_TIMEOUT = 10000;

const router = Router();

interface CommitFile {
  path: string;
  additions: number;
  deletions: number;
}

interface RefInfo {
  type: 'head' | 'branch' | 'remote' | 'tag';
  name: string;
}

interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  refs: RefInfo[];
  message: string;
  author: string;
  date: string;
  files: CommitFile[];
}

// Git log with optional file filter
router.get('/api/sessions/:sessionId/git-log', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;

  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 30));
  const file = req.query.file as string | undefined;
  if (file && (file.includes('..') || file.startsWith('/'))) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }
  const all = req.query.all === 'true';
  const branch = req.query.branch as string | undefined;
  if (branch && !/^[\w\-\/.]+$/.test(branch)) {
    res.status(400).json({ error: 'Invalid branch name' });
    return;
  }
  const skip = (page - 1) * limit;

  let cwd: string;
  try {
    cwd = await getCwd(sessionName);
  } catch {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    // Use a separator that won't appear in commit messages
    const SEP = '---GIT-LOG-SEP---';
    const format = `${SEP}%n%H%n%h%n%P%n%D%n%s%n%an%n%aI`;

    const args = ['log', '--topo-order', `--pretty=format:${format}`, '--numstat', `--skip=${skip}`, `-${limit + 1}`];
    if (all) args.splice(1, 0, '--all');
    if (branch && !all) args.push(branch);
    if (file) {
      args.push('--', file);
    }

    const { stdout } = await execFile('git', args, { cwd, timeout: EXEC_TIMEOUT });

    const commits: CommitInfo[] = [];
    const blocks = stdout.split(SEP).filter((b) => b.trim());

    for (const block of blocks) {
      // Don't filter empty lines — %P and %D may be empty (root commits, no refs)
      // Block starts with \n from format, so drop the leading empty entry
      const rawLines = block.split('\n');
      // Drop leading empty line from format separator
      if (rawLines[0] === '') rawLines.shift();
      // First 7 lines are fixed fields; remaining are numstat file lines
      if (rawLines.length < 7) continue;

      const [hash, shortHash, parentLine, refLine, message, author, date, ...fileLines] = rawLines;

      const parents = parentLine.trim() ? parentLine.trim().split(' ') : [];

      const refs: RefInfo[] = [];
      if (refLine.trim()) {
        for (const raw of refLine.split(',')) {
          const part = raw.trim();
          if (!part) continue;
          if (part.startsWith('HEAD -> ')) {
            refs.push({ type: 'head', name: part.slice(8) });
          } else if (part === 'HEAD') {
            refs.push({ type: 'head', name: 'HEAD' });
          } else if (part.startsWith('tag: ')) {
            refs.push({ type: 'tag', name: part.slice(5) });
          } else if (part.includes('/')) {
            refs.push({ type: 'remote', name: part });
          } else {
            refs.push({ type: 'branch', name: part });
          }
        }
      }

      const files: CommitFile[] = [];

      for (const fl of fileLines) {
        const match = fl.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (match) {
          files.push({
            additions: match[1] === '-' ? 0 : parseInt(match[1], 10),
            deletions: match[2] === '-' ? 0 : parseInt(match[2], 10),
            path: match[3],
          });
        }
      }

      commits.push({ hash, shortHash, parents, refs, message, author, date, files });
    }

    const hasMore = commits.length > limit;
    if (hasMore) commits.pop();

    res.json({ commits, hasMore });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not a git repository')) {
      res.json({ commits: [], hasMore: false, error: 'Not a git repository' });
    } else {
      console.error('[api:git-log]', msg);
      res.status(500).json({ error: 'Failed to get git log' });
    }
  }
});

// Git diff for a specific commit
router.get('/api/sessions/:sessionId/git-diff', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;

  const commit = req.query.commit as string;
  if (!commit || !/^[a-f0-9]{7,40}$/.test(commit)) {
    res.status(400).json({ error: 'Invalid commit hash' });
    return;
  }
  const file = req.query.file as string | undefined;
  if (file && (file.includes('..') || file.startsWith('/'))) {
    res.status(400).json({ error: 'Invalid file path' });
    return;
  }

  let cwd: string;
  try {
    cwd = await getCwd(sessionName);
  } catch {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    // Check if it's the root commit (no parent)
    let args: string[];
    try {
      await execFile('git', ['rev-parse', `${commit}~1`], { cwd, timeout: EXEC_TIMEOUT });
      args = ['diff', `${commit}~1`, commit];
    } catch {
      // Root commit
      args = ['diff', '--root', commit];
    }

    if (file) {
      args.push('--', file);
    }

    const { stdout } = await execFile('git', args, { cwd, timeout: EXEC_TIMEOUT });
    res.json({ diff: stdout });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api:git-diff]', msg);
    res.status(500).json({ error: 'Failed to get diff' });
  }
});

// Git branches list
router.get('/api/sessions/:sessionId/git-branches', async (req, res) => {
  const sessionName = resolveSession(req, res);
  if (!sessionName) return;

  let cwd: string;
  try {
    cwd = await getCwd(sessionName);
  } catch {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  try {
    const { stdout } = await execFile('git', ['branch', '-a', '--no-color'], { cwd, timeout: EXEC_TIMEOUT });
    const branches: string[] = [];
    let current = '';

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('* ')) {
        current = trimmed.slice(2);
        branches.push(current);
      } else {
        branches.push(trimmed);
      }
    }

    res.json({ current, branches });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not a git repository')) {
      res.json({ current: '', branches: [] });
    } else {
      console.error('[api:git-branches]', msg);
      res.status(500).json({ error: 'Failed to get branches' });
    }
  }
});

export default router;
