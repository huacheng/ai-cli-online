import * as pty from 'node-pty';
import { spawn } from 'child_process';
import type { ClaudeCodeResult } from './types.js';

export interface ClaudeCodeOptions {
  workingDir: string;
  message: string;
  sessionId?: string;
  onData?: (data: string) => void; // Callback for real-time streaming output
}

const CLAUDE_PATH = process.env.CLAUDE_PATH || '/home/ubuntu/.local/bin/claude';

/**
 * Execute Claude Code CLI with a message using node-pty for proper TTY support
 */
export async function executeClaudeCode(options: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
  const { workingDir, message, sessionId, onData } = options;

  return new Promise((resolve) => {
    const args = ['--print', '--dangerously-skip-permissions'];

    // Add session resume if provided
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    // Add the message as the last argument (no shell escaping needed with pty)
    args.push(message);

    console.log(`[Claude] Executing in ${workingDir}: ${CLAUDE_PATH}`, args);

    // Use node-pty for proper TTY emulation
    const ptyProcess = pty.spawn(CLAUDE_PATH, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: workingDir,
      env: {
        ...process.env,
        CI: 'true', // Non-interactive mode
        TERM: 'xterm-256color',
      },
    });

    let output = '';

    // Handle data output (real-time streaming)
    ptyProcess.onData((data) => {
      output += data;
      console.log(`[Claude pty] ${data}`);

      // Call streaming callback if provided
      if (onData) {
        onData(data);
      }
    });

    // Handle process exit
    ptyProcess.onExit(({ exitCode }) => {
      console.log(`[Claude] Process exited with code ${exitCode}`);

      // Clean up ANSI escape codes from output
      const cleanOutput = stripAnsi(output).trim();

      if (exitCode === 0) {
        resolve({
          success: true,
          output: cleanOutput,
        });
      } else {
        resolve({
          success: false,
          output: cleanOutput,
          error: `Process exited with code ${exitCode}`,
        });
      }
    });
  });
}

/**
 * Strip ANSI escape codes and control characters from string
 */
function stripAnsi(str: string): string {
  return str
    // Standard ANSI escape sequences
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    // OSC (Operating System Command) sequences like \x1B]...;\x07
    // eslint-disable-next-line no-control-regex
    .replace(/\x1B\][^\x07]*\x07/g, '')
    // Bell character
    // eslint-disable-next-line no-control-regex
    .replace(/\x07/g, '')
    // Other control characters except newline and tab
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Check if Claude Code CLI is available
 */
export async function checkClaudeCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(CLAUDE_PATH, ['--version']);

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}
