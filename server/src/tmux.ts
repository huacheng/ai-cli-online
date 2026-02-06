import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

/**
 * Generate a tmux session name from an auth token.
 * Uses SHA256 prefix to avoid leaking the token.
 */
export function tokenToSessionName(token: string): string {
  const hash = createHash('sha256').update(token).digest('hex');
  return `cli-online-${hash.slice(0, 8)}`;
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

  // Increase history limit for all future panes in this server
  try {
    execFileSync('tmux', ['set-option', '-g', 'history-limit', '50000'], { stdio: 'ignore' });
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

/** Check if tmux is available on the system */
export function isTmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
