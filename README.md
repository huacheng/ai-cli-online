# CLI-Online

Claude Code Web Assistant - 通过 Web 界面访问 Claude Code

## 功能特性

- **对话式交互**: 用自然语言描述任务，Claude Code 执行
- **工作目录导航**: 显示/切换当前工作目录
- **会话持久化**: 服务端保存对话历史，断连后自动恢复
- **自动重连**: 网络断开后浏览器自动重连

## 快速开始

### 前提条件

- Node.js >= 18
- Claude Code CLI 已安装 (`npm install -g @anthropic-ai/claude-code`)

### 安装

```bash
# 安装依赖
npm install

# 构建前端
cd web && npm run build && cd ..
```

### 运行

**开发模式** (前后端分离):

```bash
# 终端 1: 启动后端
cd server && npm run dev

# 终端 2: 启动前端
cd web && npm run dev
```

然后访问 http://localhost:3000

**生产模式** (一体化):

```bash
# 构建前端
cd web && npm run build && cd ..

# 启动服务
cd server && npm start
```

然后访问 http://localhost:3001

## 配置

创建 `server/.env` 文件:

```env
# 服务端口
PORT=3001

# 认证 Token (可选，生产环境建议设置)
AUTH_TOKEN=your-secret-token

# 默认工作目录
DEFAULT_WORKING_DIR=/home/ubuntu
```

## 项目结构

```
cli-online/
├── server/          # 后端服务
│   └── src/
│       ├── index.ts      # 主入口
│       ├── websocket.ts  # WebSocket 处理
│       ├── claude.ts     # Claude Code 调用
│       ├── storage.ts    # 数据存储
│       └── types.ts      # 类型定义
├── web/             # 前端应用
│   └── src/
│       ├── App.tsx       # 主组件
│       ├── store.ts      # 状态管理
│       ├── components/   # UI 组件
│       └── hooks/        # React Hooks
└── package.json     # 根配置
```

## 使用示例

1. 打开浏览器访问应用
2. 在顶部确认/切换工作目录
3. 在输入框描述你的任务，例如：
   - "帮我创建一个 hello.py 文件，打印 Hello World"
   - "列出当前目录的所有文件"
   - "初始化一个新的 git 仓库"
4. 等待 Claude Code 执行并查看结果

## License

MIT
