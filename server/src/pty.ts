import * as pty from 'node-pty';

export type DataCallback = (data: string) => void;
export type ExitCallback = (code: number, signal: number) => void;

/**
 * Wraps node-pty to attach to a tmux session.
 * When the WebSocket disconnects, we kill only the PTY (detach from tmux),
 * leaving the tmux session alive for later reconnection.
 */
/** Keys to strip from the environment passed to PTY subprocesses */
const SENSITIVE_ENV_KEYS = ['AUTH_TOKEN', 'SECRET', 'PASSWORD', 'API_KEY', 'PRIVATE_KEY', 'ACCESS_TOKEN'];

function sanitizedEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  for (const key of Object.keys(env)) {
    if (SENSITIVE_ENV_KEYS.some((s) => key.toUpperCase().includes(s))) {
      delete env[key];
    }
  }
  return env;
}

export class PtySession {
  private proc: pty.IPty;
  private dataListeners: DataCallback[] = [];
  private exitListeners: ExitCallback[] = [];
  private alive = true;

  constructor(sessionName: string, cols: number, rows: number) {
    this.proc = pty.spawn('tmux', ['attach-session', '-t', sessionName], {
      name: 'xterm-256color',
      cols,
      rows,
      env: sanitizedEnv(),
    });

    this.proc.onData((data) => {
      for (const cb of this.dataListeners) {
        cb(data);
      }
    });

    this.proc.onExit(({ exitCode, signal }) => {
      this.alive = false;
      for (const cb of this.exitListeners) {
        cb(exitCode ?? 0, signal ?? 0);
      }
    });
  }

  onData(cb: DataCallback): void {
    this.dataListeners.push(cb);
  }

  onExit(cb: ExitCallback): void {
    this.exitListeners.push(cb);
  }

  write(data: string): void {
    if (this.alive) {
      this.proc.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.alive) {
      this.proc.resize(cols, rows);
    }
  }

  kill(): void {
    if (this.alive) {
      this.alive = false;
      try {
        this.proc.kill();
      } catch (err) {
        console.error('[PTY] kill() error (process may have already exited):', err);
      }
    }
    // Clear listener arrays to release closure references for GC
    this.dataListeners = [];
    this.exitListeners = [];
  }

  isAlive(): boolean {
    return this.alive;
  }
}
