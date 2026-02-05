import { spawn } from 'child_process';
import type { ClaudeCodeResult } from './types.js';

export interface ClaudeCodeOptions {
  workingDir: string;
  message: string;
  sessionId?: string;
}

/**
 * Execute Claude Code CLI with a message
 */
export async function executeClaudeCode(options: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
  const { workingDir, message, sessionId } = options;

  return new Promise((resolve) => {
    const args = ['--print', '--dangerously-skip-permissions'];

    // Add session resume if provided
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    // Add the prompt as the last argument (not --message)
    args.push(message);

    console.log(`[Claude] Executing in ${workingDir}: claude ${args.join(' ')}`);

    const proc = spawn('claude', args, {
      cwd: workingDir,
      env: {
        ...process.env,
        // Ensure non-interactive mode
        CI: 'true',
      },
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      console.log(`[Claude stdout] ${chunk}`);
    });

    proc.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      console.log(`[Claude stderr] ${chunk}`);
    });

    proc.on('close', (code) => {
      console.log(`[Claude] Process exited with code ${code}`);

      if (code === 0) {
        resolve({
          success: true,
          output: stdout.trim(),
        });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      console.error(`[Claude] Process error:`, err);
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

/**
 * Check if Claude Code CLI is available
 */
export async function checkClaudeCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], { shell: true });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}
