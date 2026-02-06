# CLI-Online - Web Terminal for Claude Code

## 项目概述

CLI-Online 通过 xterm.js + tmux 让用户在浏览器中使用完整的终端环境。tmux 保证断网后进程存活，重连即恢复。

## 架构

```
浏览器 (xterm.js) ←WebSocket raw I/O→ Express (node-pty) ←→ tmux session → shell/claude
```

- **前端**: React + Zustand + xterm.js
- **后端**: Node.js + Express + node-pty + WebSocket
- **会话管理**: tmux (持久化终端会话)

## 目录结构

```
cli-online/
├── server/           # 后端服务 (TypeScript)
│   └── src/
│       ├── index.ts      # 主入口，HTTP + WebSocket + 静态文件服务
│       ├── websocket.ts  # WebSocket ↔ PTY 双向 relay
│       ├── tmux.ts       # tmux 会话管理 (创建/attach/capture/resize/kill)
│       ├── pty.ts        # node-pty 封装
│       └── types.ts      # 共享类型定义
├── web/              # 前端应用 (React + Vite)
│   └── src/
│       ├── App.tsx           # 主应用组件 (Login / Terminal)
│       ├── store.ts          # Zustand 状态管理
│       ├── types.ts          # 类型定义
│       ├── index.css         # 全局样式 + xterm.css
│       ├── hooks/
│       │   └── useTerminalWebSocket.ts  # WebSocket + 自动重连
│       └── components/
│           ├── LoginForm.tsx     # Token 认证表单
│           └── TerminalView.tsx  # xterm.js 终端视图
└── package.json      # Monorepo 配置
```

## 开发命令

```bash
# 安装依赖
npm install

# 开发模式 (前后端分离)
npm run dev

# 单独启动后端
npm run dev:server

# 单独启动前端
npm run dev:web

# 构建
npm run build

# 生产模式启动
npm start
```

## 配置

后端配置文件: `server/.env`

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3001 |
| HOST | 绑定地址 | 0.0.0.0 |
| AUTH_TOKEN | 认证 Token | (空，无认证) |
| DEFAULT_WORKING_DIR | 默认工作目录 | $HOME |

## WebSocket 协议

### 客户端 → 服务端

| type | payload | 说明 |
|------|---------|------|
| `input` | `{ data: string }` | 原始键入数据 |
| `resize` | `{ cols, rows }` | 终端尺寸变更 |
| `ping` | - | 心跳检测 |

### 服务端 → 客户端

| type | payload | 说明 |
|------|---------|------|
| `output` | `{ data: string }` | PTY 输出 (原始 ANSI) |
| `scrollback` | `{ data: string }` | 重连时的历史输出 |
| `connected` | `{ resumed: boolean }` | 连接状态 |
| `error` | `{ error: string }` | 错误信息 |
| `pong` | `{ timestamp }` | 心跳响应 |

连接时通过 query string 传参: `?token=X&cols=80&rows=24`

## 会话管理

- 每个 AUTH_TOKEN 对应一个 tmux session (名称为 token SHA256 前 8 位)
- 断网后 tmux session 继续运行，重连时通过 `capture-pane` 恢复历史
- 同一 token 的新连接会踢掉旧连接
- 浏览器窗口 resize 自动同步到 tmux

## 前置要求

- Node.js 18+
- tmux 已安装 (`sudo apt install tmux`)
- 前端开发时通过 Vite 代理连接后端 (localhost:3001)
- 生产模式下后端直接服务前端静态文件

## 待实现功能

- [ ] 多对话并行 (多个 tmux session)
- [ ] 2xN 瀑布式布局
- [ ] 成果文档导出
