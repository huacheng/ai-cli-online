# AI-CLI-Online - Web Terminal for Claude Code

## 项目概述

AI-CLI-Online 通过 xterm.js + tmux 让用户在浏览器中使用完整的终端环境。tmux 保证断网后进程存活，固定 socket 路径使服务重启后自动重连。支持 Tab 多标签页、多终端分屏（水平/垂直任意嵌套）、2D 网格面板布局（[Xterm | Plan] + [Chat]，三区域可同时显示）、Plan 批注系统（TASK/ 目录多文件批注 + Mermaid 图表）、Chat 编辑器（多行编辑 + 斜杠命令 + 草稿持久化）、Light/Dark 主题切换、鼠标选中自动复制 + 右键粘贴，以及 capture-pane 滚动历史回看（带 ANSI 颜色）。

## 架构

```
浏览器 (xterm.js + WebGL) ←WebSocket binary/JSON→ Express (node-pty) ←→ tmux session → shell/claude
```

- **前端**: React + Zustand + xterm.js (WebGL 渲染)
- **后端**: Node.js + Express + node-pty + WebSocket + better-sqlite3
- **会话管理**: tmux (持久化终端会话)
- **布局系统**: Tab 标签页 + 递归树形结构 (LeafNode / SplitNode)
- **传输协议**: 二进制帧 (热路径) + JSON (控制消息)
- **数据持久化**: SQLite (编辑器草稿 + 用户设置)

## 目录结构

```
ai-cli-online/
├── shared/           # 共享类型定义 (ClientMessage, ServerMessage)
│   └── src/types.ts
├── server/           # 后端服务 (TypeScript)
│   └── src/
│       ├── index.ts      # 主入口，HTTP + WebSocket + REST API + 静态文件服务
│       ├── websocket.ts  # WebSocket ↔ PTY 双向 relay (二进制协议 + JSON 控制)
│       ├── tmux.ts       # tmux 会话管理 (创建/attach/capture/resize/kill/getCwd)
│       ├── files.ts      # 文件操作 (listFiles/validatePath/validatePathNoSymlink/validateNewPath/cachedRealpath)
│       ├── pty.ts        # node-pty 封装
│       ├── db.ts         # SQLite 数据库 (better-sqlite3, WAL 模式, 草稿持久化)
│       ├── auth.ts       # 认证工具 (timing-safe token 比较)
│       └── types.ts      # 类型 re-export
├── web/              # 前端应用 (React + Vite)
│   └── src/
│       ├── main.tsx          # React 入口 (ReactDOM.createRoot)
│       ├── App.tsx           # 主应用组件 (Login / TabBar / Terminal / 主题切换)
│       ├── store.ts          # Zustand 状态管理 (tabs + terminalsMap + 主题 + 面板状态)
│       ├── types.ts          # 类型定义 (LayoutNode, TerminalInstance, PanelState)
│       ├── utils.ts          # 工具函数 (formatSize/formatTime/fileIcon)
│       ├── fileStreamBus.ts  # 文件流事件总线 (跨组件 chunk/control 分发)
│       ├── index.css         # 全局样式 + CSS 变量主题 + xterm.css
│       ├── hooks/
│       │   ├── useTerminalWebSocket.ts  # WebSocket 二进制协议 + 自动重连 + RTT 测量
│       │   ├── useFileStream.ts         # 文件流式传输 hook (chunk 接收 + 进度跟踪)
│       │   ├── useTextareaKit.ts        # Textarea 工具 hook (Tab 缩进 + undo 栈 + 斜杠命令)
│       │   ├── useMermaidRender.ts      # Mermaid 图表渲染 hook (CDN 懒加载 + fallback)
│       │   └── usePasteFloat.ts         # 粘贴浮层 hook (文件粘贴上传)
│       ├── api/
│       │   ├── client.ts          # API 基础配置 (API_BASE + authHeaders)
│       │   ├── files.ts           # 文件传输 API (上传/下载/列表/touch/mkdir/rm/downloadCwd)
│       │   ├── annotations.ts     # 批注持久化 API (fetchAnnotation/saveAnnotation)
│       │   ├── docs.ts            # 文档内容 API (fetchFileContent, 支持 304)
│       │   ├── drafts.ts          # 编辑器草稿 API (fetchDraft/saveDraft)
│       │   ├── settings.ts        # 用户设置 API (字体大小读写)
│       │   ├── tabs.ts            # Tab 状态 API (布局持久化)
│       │   └── plans.ts           # 终端命令检测 API (fetchPaneCommand)
│       └── components/
│           ├── LoginForm.tsx          # Token 认证表单
│           ├── TabBar.tsx             # Tab 多标签页栏 (新增/切换/关闭/重命名)
│           ├── TerminalView.tsx       # xterm.js 终端视图 (WebGL addon + Dark/Light 双主题)
│           ├── TerminalPane.tsx       # 终端面板 (2D 网格: [Xterm | Plan] + [Chat])
│           ├── PlanPanel.tsx          # Plan 批注面板 (内联, TASK/ 目录多文件批注)
│           ├── PlanAnnotationRenderer.tsx  # Plan 批注渲染器 (内联批注 + Mermaid 图表)
│           ├── PlanFileBrowser.tsx    # Plan 文件浏览器 (TASK/ 目录树 + 新建文件)
│           ├── MarkdownEditor.tsx     # Chat 编辑器 (多行编辑 + 斜杠命令 + 草稿持久化)
│           ├── MarkdownToc.tsx        # Markdown 目录导航 (heading 提取 + 锚点跳转)
│           ├── ErrorBoundary.tsx      # React 错误边界
│           ├── SessionSidebar.tsx     # 会话侧边栏 (列表/恢复/删除/重命名/关闭终端)
│           └── SplitPaneContainer.tsx # 递归布局渲染 (水平/垂直分割)
├── .commands/        # Claude Code 自定义斜杠命令源文件
│   └── aicli-task-review.md  # /aicli-task-review 批注审阅命令
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
| TRUST_PROXY | 反向代理信任层数 | (空，不信任) |
| RATE_LIMIT_READ | 只读 API 限速 (次/分钟) | 180 |
| RATE_LIMIT_WRITE | 写入 API 限速 (次/分钟) | 60 |

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

## 状态管理

Zustand store 采用 Tab + Terminal 两级结构：

```typescript
tabs: TabState[];                                 // Tab 标签页列表
activeTabId: string;                              // 当前激活的 Tab
terminalsMap: Record<string, TerminalInstance>;    // O(1) 查找
latency: number | null;                           // 全局网络延迟 (ms)
theme: 'dark' | 'light';                          // 全局主题 (持久化 localStorage)
```

每个 `TerminalInstance` 拥有 `panels: PanelState`，控制 Chat 和 Plan 面板的开关状态：

```typescript
interface PanelState {
  chatOpen: boolean;
  planOpen: boolean;
}
```

每个 `TabState` 拥有独立的 `terminalIds`、`layout` 和 `panelStates`，Tab 间完全隔离。

- `toggleChat(id)` / `togglePlan(id)` 独立切换面板，Chat 和 Plan 可同时打开
- `toggleTheme()` 切换 Dark/Light 主题，同步更新 `document.documentElement.dataset.theme`
- `setTerminalConnected/Resumed/Error` 仅更新目标终端对象，不触发其他面板重渲染
- 全局 `latency` 由任意活跃 WebSocket 的 ping/pong RTT 更新
- Tab 状态通过 `PersistedTabsState` 序列化到 localStorage，刷新后恢复

## WebSocket 协议

### 二进制帧 (热路径，高频)

格式: `[1 字节类型前缀][原始 UTF-8 载荷]`

| 前缀 | 方向 | 说明 |
|------|------|------|
| `0x01` | S→C | PTY 输出 (原始 ANSI) |
| `0x02` | C→S | 用户键入 |
| `0x03` | S→C | 重连时的 scrollback 历史 |
| `0x04` | S→C | capture-pane 滚动历史 (ANSI + 已归一化 `\r\n`) |

客户端 `ws.binaryType = 'arraybuffer'`，xterm.js 直接 `write(Uint8Array)` 零拷贝渲染。

### JSON 消息 (控制路径，低频)

#### 客户端 → 服务端

| type | payload | 说明 |
|------|---------|------|
| `auth` | `{ token: string }` | 首条消息认证 |
| `input` | `{ data: string }` | 键入数据 (Legacy JSON 回退) |
| `resize` | `{ cols, rows }` | 终端尺寸变更 |
| `ping` | - | 心跳 + RTT 测量 |
| `capture-scrollback` | - | 请求 capture-pane 滚动历史 |

#### 服务端 → 客户端

| type | payload | 说明 |
|------|---------|------|
| `connected` | `{ resumed: boolean }` | 连接状态 |
| `error` | `{ error: string }` | 错误信息 |
| `pong` | `{ timestamp }` | 心跳响应 (客户端据此算 RTT) |

连接时通过 query string 传参: `?sessionId=t1`，认证通过首条 `auth` 消息完成。

## 性能优化

### 传输层
- **二进制协议**: output/input/scrollback 使用 1 字节前缀二进制帧，消除 JSON 序列化开销
- **TCP Nagle 禁用**: `socket.setNoDelay(true)` 消除最多 40ms 按键延迟
- **WebSocket 压缩**: `perMessageDeflate` (level 1, threshold 128B)，带宽减少 50-70%
- **maxPayload 1MB**: 支持大粘贴操作

### 渲染层
- **WebGL 渲染器**: `@xterm/addon-webgl` 渲染吞吐量提升 3-10x (自动回退 canvas)
- **CSS 层隔离**: `contain: strict` + `will-change: transform` + `isolation: isolate`
- **rAF resize**: ResizeObserver 用 `requestAnimationFrame` 对齐渲染帧，网络 resize 50ms debounce

### 连接优化
- **即时 resize**: 收到 `connected` 后立即发送尺寸，无盲等延迟
- **服务端换行归一化**: scrollback 的 `\n → \r\n` 在服务端完成，避免客户端主线程阻塞
- **tmux 配置单次调用**: 3 个 set-option 合并为单次 tmux 命令（`;` 分隔符），所有 execFile 调用带 5s 超时保护
- **session 初始化并行化**: PTY 创建与 tmux 配置并行执行
- **PTY/tmux resize 并行**: resize 时 PTY 和 tmux 同时调整
- **重连 jitter**: 重连时随机延迟，避免多客户端同时重连造成雷群效应
- **sendBinary 零拷贝**: 消除双重 Buffer 分配

### 网络状态指示器
- 全局 ping/pong RTT 测量，header 显示信号条 + 延迟毫秒数
- 颜色阈值: 绿(<50ms) 黄(<150ms) 橙(<300ms) 红(>=300ms)

## 文件传输 REST API

所有文件传输端点都需要 `Authorization: Bearer <token>` 认证。

| 方法 | 路径 | 功能 |
|------|------|------|
| `GET` | `/api/sessions/:sessionId/cwd` | 返回 tmux session 的当前工作目录 |
| `GET` | `/api/sessions/:sessionId/files` | 列出目录文件（query: `path` 可选，默认为 CWD） |
| `POST` | `/api/sessions/:sessionId/upload` | multipart 上传文件到 CWD（multer, 最多 10 文件, 单文件 100MB） |
| `GET` | `/api/sessions/:sessionId/download` | 流式下载文件（query: `path` 指定文件路径） |
| `GET` | `/api/sessions/:sessionId/file-content` | 读取文件内容（query: `path`, `since`; 支持 304 未修改） |
| `GET` | `/api/sessions/:sessionId/draft` | 获取编辑器草稿内容 |
| `PUT` | `/api/sessions/:sessionId/draft` | 保存编辑器草稿内容 |
| `POST` | `/api/sessions/:sessionId/touch` | 创建空文件（JSON body: `{ name }`) |
| `POST` | `/api/sessions/:sessionId/mkdir` | 创建目录（JSON body: `{ path }`) |
| `DELETE` | `/api/sessions/:sessionId/rm` | 删除文件或目录（JSON body: `{ path }`，目录递归删除） |
| `GET` | `/api/sessions/:sessionId/download-cwd` | 打包下载 CWD 目录（tar.gz 流式响应） |
| `GET` | `/api/sessions/:sessionId/annotations` | 获取文件批注（query: `path`） |
| `PUT` | `/api/sessions/:sessionId/annotations` | 保存文件批注（JSON body: `{ path, content, updatedAt }`） |
| `GET` | `/api/sessions/:sessionId/pane-command` | 获取当前 tmux pane 正在执行的命令 |
| `GET` | `/api/settings/font-size` | 获取用户字体大小设置 |
| `PUT` | `/api/settings/font-size` | 保存用户字体大小设置 (10-24) |

实现细节：
- CWD 通过 `tmux list-panes -F #{pane_current_path}` 获取，反映终端当前所在目录
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

- 点击终端右上角 `↑` 按钮 → 发送 `capture-scrollback` 请求（按钮 `tabIndex={-1}` + `blur()` 防止空格键误触发）
- 服务端执行 `tmux capture-pane -t '=${name}:' -p -e -S -10000`，`-e` 保留 ANSI 颜色转义码
  - **注意**: `-t` 必须使用 `=${name}:` 格式（`=` 精确匹配 + `:` 定位到活动 pane），纯 `=${name}` 对 pane 级命令无效
- 服务端将 `\n` 归一化为 `\r\n` 后通过二进制帧发送
- 前端用只读 xterm.js 实例 (`disableStdin: true`, `scrollback: 50000`) + WebGL 渲染器渲染
- 覆盖层使用绝对定位布局（`position: absolute`），确保容器尺寸可用后执行 `fitAddon.fit()`，带间隔重试机制
- ESC 键通过 `terminal.attachCustomKeyEventHandler` 拦截（因为 xterm.js 即使 `disableStdin: true` 仍会捕获键盘事件），或点击 `✕` 关闭覆盖层

## tmux 配置

创建 session 时通过单次 tmux 命令设置以下选项（`;` 分隔符合并）：

| 选项 | 值 | 说明 |
|------|-----|------|
| history-limit | 50000 | 大容量滚动历史 |
| status | off | 关闭状态栏，避免 scrollback 噪音 |
| mouse | off | 鼠标滚轮由 xterm.js 处理 |

### tmux `-t` 目标格式

| 命令类型 | 格式 | 示例 | 说明 |
|----------|------|------|------|
| session 级 | `=${name}` | `has-session -t '=${name}'` | `=` 前缀精确匹配，防止 `t1` 匹配 `t10` |
| pane 级 | `=${name}:` | `capture-pane -t '=${name}:'` | 尾部 `:` 定位到 session 的活动 pane |

**重要**: `capture-pane`、`list-panes` 等 pane 级命令需要使用 `=${name}:` 格式。纯 `=${name}` 对 pane 级命令会返回 "can't find pane" 错误。`=` 精确匹配前缀不可省略，否则会导致 session 名称模糊匹配串线（如 `t1` 误匹配 `t14`）。

## 前置要求

- Node.js 18+
- tmux 已安装 (`sudo apt install tmux`)
- 前端开发时通过 Vite 代理连接后端 (localhost:3001)
- 生产模式下后端直接服务前端静态文件
- nginx 反向代理时需设 `HTTPS_ENABLED=false`（nginx 做 SSL 终端）

## Tab 多标签页

- 顶部 TabBar 支持新增 / 切换 / 关闭 / 双击重命名
- 每个 Tab 拥有独立的终端列表和布局树，互不干扰
- Tab 状态序列化到 localStorage (`PersistedTabsState`)，刷新后自动恢复
- 关闭 Tab 时同步销毁所有关联的 tmux session

## 三区域面板布局

TerminalPane 采用 2D 网格布局，三个区域可独立开关、同时显示：

```
[Title bar: 连接状态 | Upload | Chat | Plan | 分割按钮]
[Main area: flex-direction: row]
  ├─ [Plan 面板: planWidthPercent%]         ← 仅 planOpen 时
  ├─ [水平分隔条: 2px, col-resize]          ← 仅 planOpen 时
  └─ [Right column: flex: 1, column]
      ├─ [Xterm 终端: flex: 1]
      ├─ [垂直分隔条: 4px, row-resize]      ← 仅 chatOpen 时
      └─ [Chat 面板: chatHeightPercent%]     ← 仅 chatOpen 时
```

### Xterm 终端 (TerminalView)

- xterm.js + WebGL 渲染器，支持 Dark/Light 双主题 (`DARK_XTERM_THEME` / `LIGHT_XTERM_THEME`)
- 主题跟随全局 `store.theme`，切换时实时更新 `terminal.options.theme`
- 鼠标选中自动复制到剪贴板，右键粘贴（paste 事件捕获）
- capture-pane 滚动历史回看覆盖层
- CSS 层隔离: `contain: strict` + `will-change: transform`

### Plan 批注面板 (PlanPanel)

内联面板（非全屏覆盖层），位于终端左侧全高显示，宽度可拖拽调整（20%-80%，持久化 localStorage）。

- **PlanFileBrowser**: 左侧文件树，浏览 TASK/ 目录下的 `.md` 文件，支持新建文件
- **PlanAnnotationRenderer**: 中间批注编辑器，Markdown 内容逐行渲染 + 内联批注
  - 4 种批注类型:
    - **Insert** (`+` 黄色): 行间插入，点击 InsertZone 输入内容
    - **Delete** (`−` 红色): 选中文本后删除，红色删除线标记
    - **Replace** (`↔` 蓝色): 选中文本后替换，蓝色卡片显示 "old → new"
    - **Comment** (`?` 绿色): 选中文本后评注/提问，绿色卡片显示
  - 选中文本后弹出浮动按钮组（`−` / `↔` / `?` 竖排面板），替代原来的单个删除按钮
  - 批注持久化到 SQLite（`GET/PUT /api/sessions/:sessionId/annotations`，按 session + filePath 存储）
  - Mermaid 图表内联渲染（CDN 懒加载: jsdelivr + unpkg 备源）
  - 文件切换时记忆/恢复滚动位置
- **MarkdownToc**: 右侧目录导航，从 Markdown heading 提取锚点
- 批注 Send 生成 `/aicli-task-review` 命令发送到终端，JSON 包含 4 种 Annotations 数组
- 关闭时聚合所有文件的未转发批注 → `onForwardToChat(summary)` 转发到 Chat 编辑器
- 刷新按钮重新请求当前文件的 file stream

### Chat 编辑器面板 (MarkdownEditor)

底部面板，高度可拖拽调整（15%-60%，持久化 localStorage）。

- 多行 Markdown 编辑器，支持 Tab 缩进、斜杠命令 (`/history`)
- 草稿通过 SQLite 服务端持久化（`GET/PUT /api/sessions/:sessionId/draft`）
- `Ctrl+Enter` 发送内容到终端 PTY（合并为单行 + 回车）
- Send 按钮 + `×` 关闭按钮在 Chat 工具栏
- Plan 面板关闭时的批注摘要自动填入编辑器（`fillContent`）
- 鼠标选中自动复制 + 右键粘贴

### 分隔条交互

- **水平分隔条**（Terminal ↔ Plan）: `col-resize` 光标，拖拽调整 `planWidthPercent`
- **垂直分隔条**（Top row ↔ Chat）: `row-resize` 光标，拖拽调整 `chatHeightPercent`
- 拖拽时 `document.body.classList.add('resizing-panes')` 防止 iframe/selection 干扰
- 尺寸持久化到 localStorage (`plan-width-${id}` / `doc-height-${id}`)

## Light/Dark 主题系统

- CSS 变量定义在 `:root, [data-theme="dark"]` 和 `[data-theme="light"]` 两套
- 19 个语义变量: `--bg-primary`, `--text-primary`, `--accent-blue`, `--border` 等
- 所有组件内联样式引用 `var(--xxx)`，无硬编码颜色
- Header 中太阳/月亮按钮切换，状态持久化到 `localStorage 'ai-cli-online-theme'`
- xterm.js 终端同步切换 Dark/Light 主题对象

## 编辑器草稿持久化

- 后端使用 better-sqlite3 (WAL 模式)，数据库位于 `server/data/ai-cli-online.db`
- `drafts` 表: `session_name (PK)` + `content` + `updated_at`
- `annotations` 表: `(session_name, file_path) (PK)` + `content` + `updated_at`（批注持久化）
- `settings` 表: `(token_hash, key) (PK)` + `value` + `updated_at`
- 前端通过 `GET/PUT /api/sessions/:sessionId/draft` 进行草稿读写
- 前端通过 `GET/PUT /api/settings/font-size` 读写字体大小（按 token 隔离）
- 支持跨浏览器刷新恢复编辑内容和用户设置

