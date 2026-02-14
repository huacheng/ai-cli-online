# AI-Cli Online

[![npm version](https://img.shields.io/npm/v/ai-cli-online.svg)](https://www.npmjs.com/package/ai-cli-online)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org/)

在浏览器中运行的 AI 开发环境。持久化终端会话、结构化任务生命周期、自主执行 — 单个 Node.js 进程即可运行。

专为在不稳定网络下运行 Claude Code、Codex CLI、Gemini CLI 或任意 AI CLI 而构建。tmux 保证断网后进程存活；浏览器 UI 在终端旁提供规划、批注和对话面板。

**npm:** https://www.npmjs.com/package/ai-cli-online | **GitHub:** https://github.com/huacheng/ai-cli-online

[**English**](README.md)

![screenshot](screenshot.jpg)

## 核心能力

**终端 + 规划 + 执行，一屏完成：**

```
┌─ 标签页 ────────────────────────────────────────────────────┐
│ ┌─ Plan 面板 ──────┬─ 终端 ─────────────────────────────┐   │
│ │ AiTasks/ 文件浏览 │                                    │   │
│ │ Markdown 查看器   │  $ /ai-cli-task auto my-feature    │   │
│ │ 内联批注          │  ▶ 规划中...                        │   │
│ │ (插入/删除/       │  ▶ 检查(post-plan): 通过            │   │
│ │  替换/评注)       │  ▶ 执行步骤 1/4...                  │   │
│ │                   │  ▶ 执行步骤 2/4...                  │   │
│ │ Mermaid 图表      │  ...                               │   │
│ │                   ├────────────────────────────────────┤   │
│ │                   │ Chat 编辑器                         │   │
│ │                   │ 多行 Markdown + /命令               │   │
│ └───────────────────┴────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

- **Plan 面板** — 浏览 `AiTasks/` 文件，4 种批注类型标注文档，向 AI 发送结构化反馈
- **终端** — 完整 xterm.js + WebGL 渲染，二进制协议实现超低延迟
- **Chat 编辑器** — 多行 Markdown 编辑器，斜杠命令，草稿服务端持久化
- 三个面板可同时打开，各自独立调整大小

## AI 任务生命周期

`ai-cli-task` 插件提供 8 个 skill 的完整任务执行生命周期：

```
init → plan → check → exec → check → merge → report
                ↑        ↓
              re-plan ←──┘ (遇到问题时)
```

| Skill | 功能 |
|-------|------|
| **init** | 创建任务模块 (`AiTasks/<name>/`)，git 分支，可选 worktree |
| **plan** | 生成实施计划或处理人工批注 |
| **check** | 在 3 个检查点评估可行性 (post-plan / mid-exec / post-exec) |
| **exec** | 逐步执行计划，每步验证 |
| **merge** | 合并任务分支到主干，冲突解决（最多 3 次重试） |
| **report** | 生成完成报告，提炼经验到知识库 |
| **auto** | 在单个 Claude 会话中自主运行完整生命周期 |
| **cancel** | 停止执行，设为已取消，可选清理 |

### 自主模式

```bash
/ai-cli-task auto my-feature
```

一条命令触发完整生命周期。单个 Claude 会话在内部依次运行 plan → check → exec → merge → report，所有步骤共享上下文。守护进程通过 `.auto-signal` 文件监控进度，强制超时，检测停滞。

### 任务结构

```
AiTasks/
├── .index.json                  # 模块索引
├── .experiences/                # 跨任务知识库（按领域类型分类）
│   ├── .summary.md              # 经验文件索引
│   └── <type>.md
├── .references/                 # 外部参考资料（执行中收集）
│   ├── .summary.md              # 参考文件索引
│   └── <topic>.md
└── my-feature/
    ├── .index.json              # 状态、阶段、时间戳、依赖 (JSON)
    ├── .target.md               # 需求描述（人工编写）
    ├── .summary.md              # 浓缩上下文（防止上下文溢出）
    ├── .analysis/               # 评估历史
    ├── .test/                   # 测试标准与结果
    ├── .bugfix/                 # 问题历史
    ├── .notes/                  # 研究发现
    ├── .report.md               # 完成报告
    └── .plan.md                 # 实施计划
```

### 类型感知执行

任务按领域类型分类（`software`、`dsp`、`ml`、`literary`、`science:physics` 等）。每种类型会调整规划方法、执行工具和验证标准。已完成任务的经验存储在 `.experiences/<type>.md` 中，供同类型的后续任务参考。

## 终端特性

- **会话持久化** — tmux 保证断网后进程存活；固定 socket 路径，服务重启后自动重连
- **Tab 多标签页** — 独立终端分组，布局跨刷新持久化
- **分屏布局** — 水平/垂直任意嵌套分割
- **二进制协议** — 1 字节前缀帧用于终端 I/O，TCP Nagle 禁用，WebSocket 压缩
- **WebGL 渲染** — 吞吐量比 canvas 提升 3-10 倍
- **复制粘贴** — 鼠标选中自动复制，右键粘贴
- **滚动历史** — capture-pane 回看，保留 ANSI 颜色
- **文件传输** — 上传/下载文件，浏览目录，CWD 打包下载为 tar.gz
- **网络指示器** — 实时 RTT 延迟 + 信号条
- **自动重连** — 指数退避 + jitter 防雷群效应

## 批注系统

Plan 面板提供 4 种批注类型，用于向 AI 发送结构化反馈：

| 类型 | 图标 | 说明 |
|------|------|------|
| **插入** | `+` | 在指定位置添加内容 |
| **删除** | `−` | 标记待删除的文本 |
| **替换** | `↔` | 用新文本替换旧文本 |
| **评注** | `?` | 提问或留下备注 |

批注双层持久化（localStorage + SQLite），以结构化 JSON 发送给 AI。`plan` skill 处理批注 — 按影响分级、应用变更、更新任务文件。

## 快速开始

### 方式一：npx 一键启动（推荐）

```bash
npx ai-cli-online
```

### 方式二：全局安装

```bash
npm install -g ai-cli-online
ai-cli-online
```

### 方式三：从源码运行

```bash
git clone https://github.com/huacheng/ai-cli-online.git
cd ai-cli-online
npm install
npm run build
npm start
```

## 前提条件

- Node.js >= 18
- tmux 已安装（`sudo apt install tmux` 或 `brew install tmux`）

## 配置

创建 `server/.env`：

```env
PORT=3001                        # 服务端口
HOST=0.0.0.0                     # 绑定地址
AUTH_TOKEN=your-secret-token     # 认证 Token（生产环境必须设置）
DEFAULT_WORKING_DIR=/home/user   # 默认工作目录
HTTPS_ENABLED=true               # nginx 反代时设为 false
TRUST_PROXY=1                    # nginx 反代时设为 1
```

完整选项参见 `server/.env.example`。

## 架构

```
浏览器 (xterm.js + WebGL)
  ├── Plan 面板 (批注编辑器)
  ├── Chat 编辑器 (Markdown + /命令)
  └── 终端视图 (WebGL 渲染器)
        │
        ↕ WebSocket binary/JSON + REST API
        │
Express 服务 (Node.js)
  ├── WebSocket ↔ PTY relay
  ├── tmux 会话管理
  ├── 文件传输 API
  ├── SQLite (草稿、批注、设置)
  └── 路由模块 (sessions, files, editor, settings)
        │
        ↕ PTY / tmux sockets
        │
tmux sessions → shell → Claude Code / AI agents
  └── AiTasks/ 生命周期 (init/plan/check/exec/merge/report/auto)
```

- **前端**: React + Zustand + xterm.js (WebGL)
- **后端**: Node.js + Express + node-pty + WebSocket + better-sqlite3
- **会话管理**: tmux（持久化终端会话）
- **布局系统**: Tab 标签页 + 递归分割树（LeafNode / SplitNode）
- **传输协议**: 二进制帧（热路径）+ JSON（控制消息）
- **任务系统**: 8-skill 插件，状态机 + 依赖门控 + 经验知识库

## 项目结构

```
ai-cli-online/
├── shared/              # 共享类型定义
├── server/src/
│   ├── index.ts         # 主入口 (中间件 + 路由 + 服务)
│   ├── websocket.ts     # WebSocket ↔ PTY relay (二进制 + JSON)
│   ├── tmux.ts          # tmux 会话管理
│   ├── files.ts         # 文件操作 + 路径校验
│   ├── pty.ts           # node-pty 封装
│   ├── db.ts            # SQLite 数据库
│   ├── auth.ts          # 认证工具
│   ├── middleware/       # 认证中间件
│   └── routes/          # REST API 路由 (sessions, files, editor, settings)
├── web/src/
│   ├── App.tsx           # 主应用 (登录 / TabBar / 终端 / 主题)
│   ├── store/            # Zustand 状态管理 (模块化切片)
│   ├── components/
│   │   ├── TerminalPane.tsx              # 2D 网格布局 (Plan + 终端 + Chat)
│   │   ├── TerminalView.tsx              # xterm.js 终端
│   │   ├── PlanPanel.tsx                 # Plan 批注面板
│   │   ├── PlanAnnotationRenderer.tsx    # Markdown + 内联批注
│   │   ├── PlanFileBrowser.tsx           # AiTasks/ 文件浏览器
│   │   ├── MarkdownEditor.tsx            # Chat 编辑器
│   │   └── ...
│   ├── hooks/            # React Hooks (WebSocket, 文件流, resize 等)
│   └── api/              # 类型化 API 客户端模块
├── bin/                  # npx 入口
├── start.sh              # 生产启动脚本
└── install-service.sh    # systemd + nginx 安装器
```

## 开发

```bash
# 开发模式（前后端分离）
npm run dev

# 构建
npm run build

# 生产模式（构建 + 启动）
bash start.sh
```

### systemd 服务 + nginx 反向代理

```bash
sudo bash install-service.sh             # 交互安装 (systemd + 可选 nginx 反代)
sudo systemctl start ai-cli-online       # 启动服务
sudo journalctl -u ai-cli-online -f      # 查看日志
```

安装脚本会：
1. 创建 systemd 服务，支持开机自启和进程管理
2. 检测 nginx 并可选配置反向代理（WebSocket 支持、SSL、`client_max_body_size`）
3. nginx 启用时自动设置 `HTTPS_ENABLED=false` 和 `TRUST_PROXY=1`

## 安全

- Token 认证 + timing-safe 比较
- 所有文件操作的 symlink 穿越防护
- 未认证 WebSocket 连接限制
- TOCTOU 下载防护（流式大小检查）
- CSP Headers (frame-ancestors, base-uri, form-action)
- 限速（可配置读/写阈值）

## License

MIT
