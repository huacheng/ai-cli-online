import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

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
  return `cli-online-${hash.slice(0, 8)}`;
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
export function hasSession(name: string): boolean {
  try {
    execFileSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Create a new tmux session (detached) */
export function createSession(
  name: string,
  cols: number,
  rows: number,
  cwd: string,
): void {
  execFileSync('tmux', [
    'new-session',
    '-d',
    '-s', name,
    '-x', String(cols),
    '-y', String(rows),
  ], { cwd });

  // Configure tmux for web terminal usage (per-session, not global)
  try {
    execFileSync('tmux', ['set-option', '-t', name, 'history-limit', '50000'], { stdio: 'ignore' });
    execFileSync('tmux', ['set-option', '-t', name, 'status', 'off'], { stdio: 'ignore' });
    execFileSync('tmux', ['set-option', '-t', name, 'mouse', 'off'], { stdio: 'ignore' });
  } catch {
    // Ignore if already set or server quirks
  }

  console.log(`[tmux] Created session: ${name} (${cols}x${rows}) in ${cwd}`);
}

/**
 * Capture scrollback buffer with ANSI escape sequences preserved.
 * Returns the last 1000 lines of the pane.
 */
export function captureScrollback(name: string): string {
  try {
    const output = execFileSync('tmux', [
      'capture-pane',
      '-t', name,
      '-p',
      '-e',
      '-S', '-10000',
    ], { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
    return output;
  } catch (err) {
    console.error(`[tmux] Failed to capture scrollback for ${name}:`, err);
    return '';
  }
}

/** Resize tmux window to match terminal dimensions */
export function resizeSession(name: string, cols: number, rows: number): void {
  try {
    execFileSync('tmux', [
      'resize-window',
      '-t', name,
      '-x', String(cols),
      '-y', String(rows),
    ], { stdio: 'ignore' });
  } catch {
    // Resize can fail if dimensions haven't changed, ignore
  }
}

/** Kill a tmux session */
export function killSession(name: string): void {
  try {
    execFileSync('tmux', ['kill-session', '-t', name], { stdio: 'ignore' });
    console.log(`[tmux] Killed session: ${name}`);
  } catch {
    // Session may already be gone
  }
}

/** List all tmux sessions belonging to a given token */
export function listSessions(token: string): TmuxSessionInfo[] {
  const prefix = tokenToSessionName(token) + '-';
  try {
    const output = execFileSync('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}:#{session_created}',
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    const results: TmuxSessionInfo[] = [];
    for (const line of output.trim().split('\n')) {
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
export function cleanupStaleSessions(ttlHours: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - ttlHours * 3600;
  try {
    const output = execFileSync('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}:#{session_created}:#{session_attached}',
    ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split(':');
      if (parts.length < 3) continue;
      const attached = parseInt(parts[parts.length - 1], 10);
      const created = parseInt(parts[parts.length - 2], 10);
      const name = parts.slice(0, parts.length - 2).join(':');
      // Only clean up our sessions, not other tmux users'
      if (!name.startsWith('cli-online-')) continue;
      // Skip attached sessions
      if (attached > 0) continue;
      // Kill if older than TTL
      if (created < cutoff) {
        console.log(`[tmux] Cleaning up stale session: ${name} (created ${new Date(created * 1000).toISOString()})`);
        killSession(name);
      }
    }
  } catch {
    // No tmux server or no sessions
  }
}

/** Check if tmux is available on the system */
export function isTmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
