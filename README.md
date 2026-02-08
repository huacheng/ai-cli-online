# AI-Cli Online

Web Terminal for Claude Code — 通过浏览器使用完整的终端环境

## 功能特性

- **Web 终端**: xterm.js + WebGL 渲染，完整终端体验
- **tmux 持久化**: 断网后进程存活，重连即恢复
- **Tab 多标签页**: 独立终端分组，刷新后自动恢复
- **分屏布局**: 水平 / 垂直任意嵌套分割
- **文档浏览器**: 支持 Markdown / HTML / PDF 渲染
- **编辑器面板**: 多行编辑 + 草稿 SQLite 持久化
- **文件传输**: 上传文件到 CWD + 浏览 / 下载
- **滚动历史**: capture-pane 回看，保留 ANSI 颜色
- **会话管理**: 侧边栏管理 session（恢复 / 删除 / 重命名）
- **网络指示器**: 实时 RTT 延迟 + 信号条
- **自动重连**: 断网后自动重连 + jitter 防雷群
- **安全认证**: Token 认证 + timing-safe 比较

## 快速开始

### 前提条件

- Node.js >= 18
- tmux 已安装 (`sudo apt install tmux`)

### 安装

```bash
npm install
```

### 运行

**开发模式** (前后端分离):

```bash
# 同时启动前后端
npm run dev
```

前端访问 http://localhost:3000，自动代理到后端 3001 端口。

**生产模式** (一体化):

```bash
# 一键构建并启动
bash start.sh
```

然后访问 https://localhost:3001（或通过 nginx 反向代理）

**systemd 服务** (开机自启):

```bash
sudo bash install-service.sh       # 交互确认安装
sudo systemctl start cli-online    # 启动服务
sudo journalctl -u cli-online -f   # 查看日志
```

## 配置

创建 `server/.env` 文件:

```env
# 服务端口
PORT=3001

# 绑定地址
HOST=0.0.0.0

# 认证 Token (生产环境必须设置)
AUTH_TOKEN=your-secret-token

# 默认工作目录
DEFAULT_WORKING_DIR=/home/ubuntu

# 是否启用 HTTPS (nginx 反代时设为 false)
HTTPS_ENABLED=true
```

## 项目结构

```
cli-online/
├── shared/          # 共享类型定义 (ClientMessage, ServerMessage)
├── server/          # 后端服务 (TypeScript)
│   └── src/
│       ├── index.ts      # 主入口 (HTTP + WebSocket + REST API)
│       ├── websocket.ts  # WebSocket 双向 relay (二进制 + JSON)
│       ├── tmux.ts       # tmux 会话管理
│       ├── files.ts      # 文件操作
│       ├── pty.ts        # node-pty 封装
│       ├── db.ts         # SQLite 数据库 (草稿持久化)
│       ├── auth.ts       # 认证工具
│       └── types.ts      # 类型定义
├── web/             # 前端应用 (React + Vite)
│   └── src/
│       ├── App.tsx        # 主应用组件
│       ├── store.ts       # Zustand 状态管理
│       ├── components/    # UI 组件
│       ├── hooks/         # React Hooks
│       └── api/           # API 客户端
├── start.sh         # 生产启动脚本
└── package.json     # Monorepo 配置
```

## 架构

```
浏览器 (xterm.js + WebGL) <-WebSocket binary/JSON-> Express (node-pty) <-> tmux session -> shell
```

- **传输协议**: 二进制帧 (1 字节前缀) 用于终端 I/O，JSON 用于控制消息
- **性能优化**: TCP Nagle 禁用、WebSocket 压缩、resize 并行化、session 初始化并行化

## License

MIT
