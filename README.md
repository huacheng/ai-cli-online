# AI-Cli Online

[![npm version](https://img.shields.io/npm/v/ai-cli-online.svg)](https://www.npmjs.com/package/ai-cli-online)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)

A lightweight web terminal for accessing Claude Code (or any CLI) from your browser via xterm.js + tmux.

[**中文文档**](README.zh-CN.md)

## Features

- **Full Web Terminal** — xterm.js with WebGL rendering, binary protocol for ultra-low latency
- **Session Persistence** — tmux keeps processes alive through disconnects; reconnect and resume instantly
- **Multi-Tab** — independent terminal groups with layout persistence across browser refreshes
- **Split Panes** — horizontal / vertical splits, arbitrarily nested
- **Document Browser** — view Markdown, HTML, and PDF files alongside your terminal
- **Editor Panel** — multi-line editing with server-side draft persistence (SQLite)
- **File Transfer** — upload files to CWD, browse and download via REST API
- **Scroll History** — capture-pane scrollback viewer with ANSI color preservation
- **Session Management** — sidebar to restore, delete, and rename sessions
- **Font Size Control** — adjustable terminal font size (A−/A+) with server-side persistence
- **Network Indicator** — real-time RTT latency display with signal bars
- **Auto Reconnect** — exponential backoff with jitter to prevent thundering herd
- **Secure Auth** — token authentication with timing-safe comparison

## Comparison: AI-Cli Online vs OpenClaw

| Dimension | AI-Cli Online | OpenClaw |
|-----------|--------------|----------|
| **Positioning** | Lightweight web terminal | AI agent orchestration platform |
| **Core Use Case** | Browser-based remote terminal access | Multi-channel AI assistant |
| **Terminal Emulation** | xterm.js + WebGL | None |
| **Session Persistence** | tmux (survives disconnects) | Gateway in-memory state |
| **Multi-Tab / Split** | Tabs + arbitrarily nested panes | None |
| **Message Channels** | WebSocket (single channel) | 16+ (WhatsApp / Telegram / Slack / Discord...) |
| **Native Apps** | None (pure web) | macOS + iOS + Android |
| **Voice Interaction** | None | Voice Wake + Talk Mode |
| **AI Agent** | None built-in (run any CLI) | Pi Agent runtime + multi-agent routing |
| **Canvas / UI** | Document browser (MD / HTML / PDF) | A2UI real-time visual workspace |
| **File Transfer** | REST API upload / download | Channel-native media |
| **Security Model** | Token auth + timing-safe | Device pairing + DM policy + Docker sandbox |
| **Extensibility** | Shell scripts | 33 extensions + 60+ skills + ClawHub |
| **Transport** | Binary frames (ultra-low latency) | JSON WebSocket |
| **Deployment** | Single-node Node.js | Single-node + Tailscale Serve/Funnel |
| **Tech Stack** | React + Express + node-pty | Lit + Express + Pi Agent |
| **Package Size** | ~12 MB | ~300 MB+ |
| **Install** | `npx ai-cli-online` | `npm i -g openclaw && openclaw onboard` |

## Quick Start

### Option 1: npx (Recommended)

```bash
npx ai-cli-online
```

### Option 2: Global Install

```bash
npm install -g ai-cli-online
ai-cli-online
```

### Option 3: From Source

```bash
git clone https://github.com/huacheng/ai-cli-online.git
cd ai-cli-online
npm install
npm run build
npm start
```

## Prerequisites

- Node.js >= 18
- tmux installed (`sudo apt install tmux` or `brew install tmux`)

## Configuration

Create `server/.env`:

```env
PORT=3001                        # Server port
HOST=0.0.0.0                     # Bind address
AUTH_TOKEN=your-secret-token     # Auth token (required for production)
DEFAULT_WORKING_DIR=/home/user   # Default working directory
HTTPS_ENABLED=true               # Set to false behind nginx reverse proxy
TRUST_PROXY=1                    # Set to 1 when behind nginx/reverse proxy
```

See `server/.env.example` for all available options.

## Architecture

```
Browser (xterm.js + WebGL) <-- WebSocket binary/JSON --> Express (node-pty) <--> tmux session --> shell
```

- **Frontend**: React + Zustand + xterm.js (WebGL renderer)
- **Backend**: Node.js + Express + node-pty + WebSocket + better-sqlite3
- **Session Manager**: tmux (persistent terminal sessions)
- **Layout System**: Tabs + recursive tree structure (LeafNode / SplitNode)
- **Transport**: Binary frames (hot path) + JSON (control messages)
- **Data Persistence**: SQLite (editor drafts)

### Performance

- **Binary protocol** — 1-byte prefix frames for terminal I/O, eliminating JSON overhead
- **TCP Nagle disabled** — `setNoDelay(true)` removes up to 40 ms keystroke delay
- **WebSocket compression** — `perMessageDeflate` (level 1, threshold 128 B), 50-70% bandwidth reduction
- **WebGL renderer** — 3-10x rendering throughput vs canvas
- **Parallel initialization** — PTY creation, tmux config, and resize run concurrently

## Project Structure

```
ai-cli-online/
├── shared/          # Shared type definitions (ClientMessage, ServerMessage)
├── server/          # Backend (TypeScript)
│   └── src/
│       ├── index.ts      # Main entry (HTTP + WebSocket + REST API)
│       ├── websocket.ts  # WebSocket <-> PTY relay (binary + JSON)
│       ├── tmux.ts       # tmux session management
│       ├── files.ts      # File operations
│       ├── pty.ts        # node-pty wrapper
│       ├── db.ts         # SQLite database (draft persistence)
│       ├── auth.ts       # Auth utilities
│       └── types.ts      # Type definitions
├── web/             # Frontend (React + Vite)
│   └── src/
│       ├── App.tsx        # Main app component
│       ├── store.ts       # Zustand state management
│       ├── components/    # UI components
│       ├── hooks/         # React hooks
│       └── api/           # API client
├── start.sh         # Production start script
└── package.json     # Monorepo config
```

## Development

```bash
# Dev mode (frontend + backend separately)
npm run dev

# Build
npm run build

# Production (build + start)
bash start.sh
```

### systemd Service + nginx Reverse Proxy

```bash
sudo bash install-service.sh          # Interactive install (systemd + optional nginx)
sudo systemctl start ai-cli-online    # Start service
sudo journalctl -u ai-cli-online -f   # View logs
```

The install script will:
1. Create a systemd service for auto-start and process management
2. Detect nginx and optionally configure reverse proxy (WebSocket support, SSL, `client_max_body_size`)
3. Auto-set `HTTPS_ENABLED=false` and `TRUST_PROXY=1` in `server/.env` when nginx is enabled

## License

MIT
