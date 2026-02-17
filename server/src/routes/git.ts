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

interface CommitInfo {
  hash: string;
  shortHash: string;
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
    const format = `${SEP}%n%H%n%h%n%s%n%an%n%aI`;

    const args = ['log', `--pretty=format:${format}`, '--numstat', `--skip=${skip}`, `-${limit + 1}`];
    if (file) {
      args.push('--', file);
    }

    const { stdout } = await execFile('git', args, { cwd, timeout: EXEC_TIMEOUT });

    const commits: CommitInfo[] = [];
    const blocks = stdout.split(SEP).filter((b) => b.trim());

    for (const block of blocks) {
      const lines = block.split('\n').filter((l) => l !== '');
      if (lines.length < 5) continue;

      const [hash, shortHash, message, author, date, ...fileLines] = lines;
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

      commits.push({ hash, shortHash, message, author, date, files });
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

export default router;
