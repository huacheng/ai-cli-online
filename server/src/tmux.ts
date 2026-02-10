import { execFile as execFileCb, execFileSync } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { join } from 'path';

const _execFile = promisify(execFileCb);
const EXEC_TIMEOUT = 5000; // 5s safety timeout for all tmux calls

// ---------------------------------------------------------------------------
// Stable tmux socket path — survives PrivateTmp remounts across service restarts.
// With KillMode=process, the tmux server daemon outlives the Node.js process,
// and this fixed socket path ensures the restarted service reconnects to it.
// ---------------------------------------------------------------------------

const TMUX_SOCKET_DIR = join(process.env.HOME || '/home/ubuntu', '.tmux-sockets');
export const TMUX_SOCKET_PATH = join(TMUX_SOCKET_DIR, 'ai-cli-online');

try {
  mkdirSync(TMUX_SOCKET_DIR, { recursive: true, mode: 0o700 });
} catch {
  /* directory may already exist */
}

/** execFile wrapper: all tmux commands use the fixed socket via -S */
function tmuxExec(args: string[], options?: Record<string, unknown>) {
  return _execFile('tmux', ['-S', TMUX_SOCKET_PATH, ...args], { timeout: EXEC_TIMEOUT, ...options });
}

export interface TmuxSessionInfo {
  sessionName: string;
  sessionId: string;
  createdAt: number;
}

/**
 * Generate a tmux session name from an auth token.
 * Uses SHA256 prefix to avoid leaking the token.
 */
export function tokenToSessionName(token: string): string {
  const hash = createHash('sha256').update(token).digest('hex');
  return `ai-cli-online-${hash.slice(0, 8)}`;
}

/** Validate sessionId: only allow alphanumeric, underscore, hyphen, max 32 chars */
export function isValidSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,32}$/.test(sessionId);
}

/**
 * Build a tmux session name from token + optional sessionId.
 * Without sessionId, behaves identically to tokenToSessionName (backward compat).
 */
export function buildSessionName(token: string, sessionId?: string): string {
  const base = tokenToSessionName(token);
  return sessionId ? `${base}-${sessionId}` : base;
}

/** Check if a tmux session exists */
export async function hasSession(name: string): Promise<boolean> {
  try {
    await tmuxExec(['has-session', '-t', `=${name}`]);
    return true;
  } catch {
    return false;
  }
}

/** Configure tmux session options for web terminal usage.
 *  Note: set-option does NOT support the = exact-match prefix, so use bare name. */
export async function configureSession(name: string): Promise<void> {
  await tmuxExec([
    'set-option', '-t', name, 'history-limit', '50000', ';',
    'set-option', '-t', name, 'status', 'off', ';',
    'set-option', '-t', name, 'mouse', 'off',
  ]).catch(() => {});
}

/** Create a new tmux session (detached) */
export async function createSession(
  name: string,
  cols: number,
  rows: number,
  cwd: string,
): Promise<void> {
  await tmuxExec([
    'new-session',
    '-d',
    '-s', name,
    '-x', String(cols),
    '-y', String(rows),
  ], { cwd });

  await configureSession(name);

  console.log(`[tmux] Created session: ${name} (${cols}x${rows}) in ${cwd}`);
}

/**
 * Capture scrollback buffer with ANSI escape sequences preserved.
 * Returns the last 10000 lines of the pane.
 */
export async function captureScrollback(name: string): Promise<string> {
  try {
    const { stdout } = await tmuxExec([
      'capture-pane',
      '-t', `=${name}:`,
      '-p',
      '-e',
      '-S', '-10000',
    ], { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    console.error(`[tmux] Failed to capture scrollback for ${name}:`, err);
    return '';
  }
}

/** Resize tmux window to match terminal dimensions */
export async function resizeSession(name: string, cols: number, rows: number): Promise<void> {
  try {
    await tmuxExec([
      'resize-window',
      '-t', `=${name}`,
      '-x', String(cols),
      '-y', String(rows),
    ]);
  } catch {
    // Resize can fail if dimensions haven't changed, ignore
  }
}

/** Kill a tmux session */
export async function killSession(name: string): Promise<void> {
  try {
    await tmuxExec(['kill-session', '-t', `=${name}`]);
    console.log(`[tmux] Killed session: ${name}`);
  } catch {
    // Session may already be gone
  }
}

/** List all tmux sessions belonging to a given token */
export async function listSessions(token: string): Promise<TmuxSessionInfo[]> {
  const prefix = tokenToSessionName(token) + '-';
  try {
    const { stdout } = await tmuxExec([
      'list-sessions',
      '-F',
      '#{session_name}:#{session_created}',
    ], { encoding: 'utf-8' });

    const results: TmuxSessionInfo[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;
      const lastColon = line.lastIndexOf(':');
      if (lastColon === -1) continue;
      const sessionName = line.slice(0, lastColon);
      const createdAt = parseInt(line.slice(lastColon + 1), 10);
      if (!sessionName.startsWith(prefix)) continue;
      const sessionId = sessionName.slice(prefix.length);
      results.push({ sessionName, sessionId, createdAt });
    }
    return results;
  } catch {
    // tmux server not running or no sessions
    return [];
  }
}

/** Clean up idle tmux sessions older than the given TTL (hours) */
export async function cleanupStaleSessions(ttlHours: number): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - ttlHours * 3600;
  try {
    const { stdout } = await tmuxExec([
      'list-sessions',
      '-F',
      '#{session_name}:#{session_created}:#{session_attached}',
    ], { encoding: 'utf-8' });

    const staleNames: string[] = [];
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;
      const lastColon = line.lastIndexOf(':');
      if (lastColon === -1) continue;
      const attached = parseInt(line.slice(lastColon + 1), 10);
      const rest = line.slice(0, lastColon);
      const secondLastColon = rest.lastIndexOf(':');
      if (secondLastColon === -1) continue;
      const created = parseInt(rest.slice(secondLastColon + 1), 10);
      const name = rest.slice(0, secondLastColon);
      if (!name.startsWith('ai-cli-online-')) continue;
      if (attached > 0) continue;
      if (created < cutoff) {
        console.log(`[tmux] Cleaning up stale session: ${name} (created ${new Date(created * 1000).toISOString()})`);
        staleNames.push(name);
      }
    }
    await Promise.all(staleNames.map((name) => killSession(name)));
  } catch {
    // No tmux server or no sessions
  }
}

/** 获取 tmux session 当前活动 pane 的工作目录 */
export async function getCwd(sessionName: string): Promise<string> {
  // Use list-panes instead of display-message: display-message ignores the = exact-match prefix
  const { stdout } = await tmuxExec([
    'list-panes', '-t', `=${sessionName}`, '-F', '#{pane_current_path}',
  ], { encoding: 'utf-8' });
  return stdout.trim();
}

/** 获取 tmux pane 当前运行的命令名称 */
export async function getPaneCommand(sessionName: string): Promise<string> {
  try {
    const { stdout } = await tmuxExec([
      'list-panes', '-t', `=${sessionName}`, '-F', '#{pane_current_command}',
    ], { encoding: 'utf-8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

/** Check if tmux is available on the system (sync — startup only) */
export function isTmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
