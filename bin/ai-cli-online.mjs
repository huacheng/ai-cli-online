#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require(join(rootDir, 'package.json'));

const args = process.argv.slice(2);

// --version
if (args.includes('--version') || args.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

// --help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
ai-cli-online v${pkg.version} — Web Terminal for Claude Code

Usage:
  ai-cli-online            Start the server
  ai-cli-online --help     Show this help
  ai-cli-online --version  Show version

Environment variables (or server/.env):
  PORT                  Server port (default: 3001)
  HOST                  Bind address (default: 0.0.0.0)
  AUTH_TOKEN            Authentication token (required for production)
  HTTPS_ENABLED         Enable HTTPS (default: true)
  DEFAULT_WORKING_DIR   Default working directory

Prerequisites:
  - Node.js >= 18
  - tmux installed (sudo apt install tmux)

More info: ${pkg.homepage || 'https://github.com/huacheng/ai-cli-online'}
`.trim());
  process.exit(0);
}

// Check Node.js version
const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion < 18) {
  console.error(`Error: Node.js >= 18 is required (current: ${process.versions.node})`);
  process.exit(1);
}

// Check tmux
try {
  execFileSync('tmux', ['-V'], { stdio: 'pipe' });
} catch {
  console.error('Error: tmux is not installed.');
  console.error('Install it with: sudo apt install tmux (Debian/Ubuntu) or brew install tmux (macOS)');
  process.exit(1);
}

// Check if built
const serverEntry = join(rootDir, 'server', 'dist', 'index.js');
if (!existsSync(serverEntry)) {
  console.error('Error: Server not built. Run "npm run build" first.');
  process.exit(1);
}

// Start server
const { fork } = await import('node:child_process');
const child = fork(serverEntry, [], {
  cwd: join(rootDir, 'server'),
  stdio: 'inherit',
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});

// Forward signals
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
