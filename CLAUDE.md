# CLI-Online - Web Terminal for Claude Code

## 项目概述

CLI-Online 通过 xterm.js + tmux 让用户在浏览器中使用完整的终端环境。tmux 保证断网后进程存活，重连即恢复。支持多终端分屏（水平/垂直任意嵌套）和 capture-pane 滚动历史回看（带 ANSI 颜色）。

## 架构

```
浏览器 (xterm.js) ←WebSocket raw I/O→ Express (node-pty) ←→ tmux session → shell/claude
```

- **前端**: React + Zustand + xterm.js
- **后端**: Node.js + Express + node-pty + WebSocket
- **会话管理**: tmux (持久化终端会话)
- **布局系统**: 递归树形结构 (LeafNode / SplitNode)

## 目录结构

```
cli-online/
├── server/           # 后端服务 (TypeScript)
│   └── src/
│       ├── index.ts      # 主入口，HTTP + WebSocket + REST API + 静态文件服务
│       ├── websocket.ts  # WebSocket ↔ PTY 双向 relay
│       ├── tmux.ts       # tmux 会话管理 (创建/attach/capture/resize/kill/getCwd)
│       ├── files.ts      # 文件操作 (listFiles/validatePath)
│       ├── pty.ts        # node-pty 封装
│       └── types.ts      # 共享类型定义
├── web/              # 前端应用 (React + Vite)
│   └── src/
│       ├── App.tsx           # 主应用组件 (Login / Terminal)
│       ├── store.ts          # Zustand 状态管理 (树形布局逻辑)
│       ├── types.ts          # 类型定义 (LayoutNode, TerminalInstance)
│       ├── index.css         # 全局样式 + xterm.css + resize 光标
│       ├── hooks/
│       │   └── useTerminalWebSocket.ts  # WebSocket + 自动重连 (per terminal)
│       ├── api/
│       │   └── files.ts             # 文件传输 API 客户端 (上传/下载/列表)
│       └── components/
│           ├── LoginForm.tsx          # Token 认证表单
│           ├── TerminalView.tsx       # xterm.js 终端视图
│           ├── TerminalPane.tsx       # 终端面板 (标题栏 + 上传/下载/分割/关闭按钮)
│           ├── FileBrowser.tsx        # 文件浏览器覆盖层 (目录导航 + 下载)
│           └── SplitPaneContainer.tsx # 递归布局渲染 (水平/垂直分割)
├── start.sh          # 生产启动脚本 (构建 + 启动)
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

# 一键构建并启动 (会清理旧进程)
bash start.sh
```

## 配置

后端配置文件: `server/.env`

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3001 |
| HOST | 绑定地址 | 0.0.0.0 |
| AUTH_TOKEN | 认证 Token | (空，无认证) |
| DEFAULT_WORKING_DIR | 默认工作目录 | $HOME |
| HTTPS_ENABLED | 是否启用 HTTPS | true (需要 server/certs/) |

## 布局系统

采用递归树形数据结构，支持任意嵌套的水平/垂直分割：

```typescript
type LayoutNode = LeafNode | SplitNode;

interface LeafNode { type: 'leaf'; terminalId: string; }
interface SplitNode {
  id: string;
  type: 'split';
  direction: 'horizontal' | 'vertical';
  children: LayoutNode[];
  sizes: number[];  // 百分比
}
```

- 单终端 → LeafNode
- 水平分割 (左右) → SplitNode(direction='horizontal')
- 垂直分割 (上下) → SplitNode(direction='vertical')
- 嵌套 → SplitNode 内嵌 SplitNode，深度不限
- 关闭面板 → 父 split 只剩一个子节点时自动折叠
- 分隔条拖拽调整尺寸（flex-grow 比例分配）

## WebSocket 协议

### 客户端 → 服务端

| type | payload | 说明 |
|------|---------|------|
| `input` | `{ data: string }` | 原始键入数据 |
| `resize` | `{ cols, rows }` | 终端尺寸变更 |
| `ping` | - | 心跳检测 |
| `capture-scrollback` | - | 请求 capture-pane 滚动历史 |

### 服务端 → 客户端

| type | payload | 说明 |
|------|---------|------|
| `output` | `{ data: string }` | PTY 输出 (原始 ANSI) |
| `scrollback` | `{ data: string }` | 重连时的历史输出 (最多 10000 行) |
| `scrollback-content` | `{ data: string }` | capture-pane 滚动历史 (带 ANSI 颜色) |
| `connected` | `{ resumed: boolean }` | 连接状态 |
| `error` | `{ error: string }` | 错误信息 |
| `pong` | `{ timestamp }` | 心跳响应 |

连接时通过 query string 传参: `?token=X&cols=80&rows=24&sessionId=t1`

## 文件传输 REST API

所有文件传输端点都需要 `Authorization: Bearer <token>` 认证。

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/sessions/:sessionId/cwd` | 返回 tmux session 的当前工作目录 |
| `GET` | `/api/sessions/:sessionId/files` | 列出目录文件（query: `path` 可选，默认为 CWD） |
| `POST` | `/api/sessions/:sessionId/upload` | multipart 上传文件到 CWD（multer, 最多 10 文件, 单文件 100MB） |
| `GET` | `/api/sessions/:sessionId/download` | 流式下载文件（query: `path` 指定文件路径） |

实现细节：
- CWD 通过 `tmux display-message #{pane_current_path}` 获取，反映终端当前所在目录
- 上传使用 `copyFile` + `unlink` 而非 `rename`，以支持跨文件系统（`/tmp` → 目标目录）
- 下载使用 `fs.createReadStream` 流式响应，设置 `Content-Disposition: attachment`
- 前端上传通过 XMLHttpRequest 实现进度回调，下载通过 fetch blob + Object URL 触发浏览器下载
- nginx 反向代理时需设置 `client_max_body_size 100m`

## 会话管理

- 每个终端面板对应一个独立的 tmux session (名称为 token SHA256 前 8 位 + sessionId)
- 断网后 tmux session 继续运行，重连时通过 `capture-pane` 恢复历史
- 同一 sessionId 的新连接会踢掉旧连接
- 浏览器窗口 resize 自动同步到 tmux

## 滚动历史回看

通过 `tmux capture-pane` 实现，不依赖 `stripAltScreen`，不影响 vim/less/htop 等使用 alternate screen 的程序。

- 点击终端右上角 `↑` 按钮 → 发送 `capture-scrollback` 请求
- 服务端执行 `tmux capture-pane -p -e -S -10000`，`-e` 保留 ANSI 颜色转义码
- 前端用只读 xterm.js 实例 (`disableStdin: true`, `scrollback: 50000`) 渲染返回内容
- 渲染前将 `\n` 转为 `\r\n`（xterm.js 需要 CR+LF 才能正确换行回到第 0 列）
- ESC 键或点击 `✕` 关闭覆盖层

## tmux 配置

创建 session 时自动设置以下全局选项：

| 选项 | 值 | 说明 |
|------|-----|------|
| history-limit | 50000 | 大容量滚动历史 |
| status | off | 关闭状态栏，避免 scrollback 噪音 |
| mouse | off | 鼠标滚轮由 xterm.js 处理 |

## 前置要求

- Node.js 18+
- tmux 已安装 (`sudo apt install tmux`)
- 前端开发时通过 Vite 代理连接后端 (localhost:3001)
- 生产模式下后端直接服务前端静态文件
- nginx 反向代理时需设 `HTTPS_ENABLED=false`（nginx 做 SSL 终端）

## 待实现功能

- [x] 多对话并行 (多个 tmux session)
- [x] 水平 + 垂直分割布局
- [x] 终端滚动回看 (capture-pane + xterm.js 只读查看器，带 ANSI 颜色)
- [x] 文件上传下载 (multer 上传到 CWD + FileBrowser 浏览/下载)
- [ ] 成果文档导出
