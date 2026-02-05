# CLI-Online - Claude Code Web Assistant

## 项目概述

CLI-Online 是一个 Web 应用，让用户通过浏览器以对话方式使用 Claude Code CLI。解决了 SSH 连接不稳定导致的会话丢失问题。

## 架构

```
浏览器 (React) ←→ WebSocket ←→ 后端服务 (Express) ←→ Claude Code CLI
```

- **前端**: React + Zustand + Tailwind CSS
- **后端**: Node.js + Express + WebSocket
- **执行引擎**: Claude Code CLI (非交互模式)

## 目录结构

```
cli-online/
├── server/           # 后端服务 (TypeScript)
│   └── src/
│       ├── index.ts      # 主入口，HTTP + WebSocket + 静态文件服务
│       ├── websocket.ts  # WebSocket 消息处理
│       ├── claude.ts     # Claude Code CLI 调用封装
│       ├── storage.ts    # JSON 文件存储 (对话历史、配置)
│       └── types.ts      # 共享类型定义
├── web/              # 前端应用 (React + Vite)
│   └── src/
│       ├── App.tsx           # 主应用组件
│       ├── store.ts          # Zustand 状态管理
│       ├── types.ts          # 类型定义
│       ├── hooks/
│       │   └── useWebSocket.ts  # WebSocket 连接 Hook
│       └── components/
│           ├── WorkingDirBar.tsx  # 工作目录导航栏
│           ├── MessageList.tsx    # 消息列表
│           └── MessageInput.tsx   # 输入框
├── data/             # 运行时数据 (gitignore)
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
| `send_message` | `{ content: string }` | 发送任务给 Claude Code |
| `set_working_dir` | `{ dir: string }` | 设置工作目录 |
| `get_history` | - | 获取对话历史 |
| `ping` | - | 心跳检测 |

### 服务端 → 客户端

| type | payload | 说明 |
|------|---------|------|
| `message` | `Message` | 消息 (用户/助手) |
| `history` | `{ messages, workingDir }` | 历史记录 |
| `working_dir` | `{ workingDir }` | 工作目录变更 |
| `status` | `{ messageId, status }` | 执行状态更新 |
| `error` | `{ error }` | 错误信息 |
| `pong` | `{ timestamp }` | 心跳响应 |

## 数据存储

数据存储在 `server/data/` 目录:

- `conversations.json` - 对话历史
- `config.json` - 配置 (当前对话ID、工作目录)

## 待实现功能 (阶段二及以后)

- [ ] 实时流式输出 (PTY 模式)
- [ ] Claude Code 会话恢复 (--resume)
- [ ] 多对话并行 (最多 4 个)
- [ ] 2xN 瀑布式布局
- [ ] 成果文档导出

## 注意事项

- Claude Code CLI 必须已安装并可用
- 后端调用 Claude Code 使用 `--print --dangerously-skip-permissions` 参数
- 前端开发时通过 Vite 代理连接后端 (localhost:3001)
- 生产模式下后端直接服务前端静态文件
