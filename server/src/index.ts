import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setupWebSocket } from './websocket.js';
import { checkClaudeCodeAvailable } from './claude.js';
import { storage } from './storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment variables
config();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

async function main() {
  // Check if Claude Code is available
  const claudeAvailable = await checkClaudeCodeAvailable();
  if (!claudeAvailable) {
    console.error('ERROR: Claude Code CLI is not available. Please install it first.');
    console.error('Run: npm install -g @anthropic-ai/claude-code');
    process.exit(1);
  }
  console.log('Claude Code CLI is available');

  const app = express();
  app.use(express.json());

  // CORS middleware for development
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      workingDir: storage.getWorkingDir(),
    });
  });

  // Get current working directory
  app.get('/api/working-dir', (req, res) => {
    res.json({ workingDir: storage.getWorkingDir() });
  });

  // Set working directory
  app.post('/api/working-dir', (req, res) => {
    const { dir } = req.body;
    if (!dir) {
      return res.status(400).json({ error: 'Directory path is required' });
    }
    storage.setWorkingDir(dir);
    res.json({ workingDir: dir });
  });

  // Get conversation history
  app.get('/api/conversations', (req, res) => {
    res.json({ conversations: storage.getAllConversations() });
  });

  // Get current conversation
  app.get('/api/conversation', (req, res) => {
    const conversation = storage.getCurrentConversation();
    res.json({ conversation });
  });

  // Serve static files from web/dist in production
  const webDistPath = join(__dirname, '../../web/dist');
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    // SPA fallback - serve index.html for non-API routes
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
        return next();
      }
      res.sendFile(join(webDistPath, 'index.html'));
    });
    console.log('Serving static files from:', webDistPath);
  }

  const server = createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss, AUTH_TOKEN);

  server.listen(Number(PORT), HOST, () => {
    console.log('');
    console.log('='.repeat(50));
    console.log('  CLI-Online Server Started');
    console.log('='.repeat(50));
    console.log(`  HTTP:      http://${HOST}:${PORT}`);
    console.log(`  WebSocket: ws://${HOST}:${PORT}/ws`);
    console.log(`  Working:   ${storage.getWorkingDir()}`);
    if (AUTH_TOKEN) {
      console.log(`  Auth:      Token required`);
    } else {
      console.log(`  Auth:      No authentication (development mode)`);
    }
    console.log('='.repeat(50));
    console.log('');
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
