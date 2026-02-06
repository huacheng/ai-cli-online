# CLI-Online 变更日志

## v1.1.0 (2026-02-06)

### 文件传输

- `0f79d53` feat: 文件上传下载功能 — 每个终端面板支持上传文件到 CWD 和浏览/下载文件
  - 后端新增 4 个 REST API: cwd / files / upload / download
  - 前端 FileBrowser 覆盖层组件 (目录导航 + 文件下载)
  - TerminalPane 标题栏新增上传(↑)和文件浏览(↓)按钮
  - multer 处理 multipart 上传, copyFile+unlink 支持跨文件系统

## v1.0.0 (2026-02-06)

### 安全加固

- `6f60ebc` fix: CORS 允许 Authorization header + trust proxy 配置
- `6f1dd03` security: token 从 URL 迁移到 Authorization header 和 WebSocket first-message auth
- `ee46199` fix: 添加 helmet 安全头和 API rate limiting
- `f7bdc77` fix: tmux per-session 选项、timing-safe token 比较、graceful shutdown
- `e2e06bb` fix: CORS 可配置、per-token 连接数限制、孤儿 session TTL 清理
- `d6d0244` fix: 安全与稳定性加固 — sessionId 校验、env 过滤、resize 限制

### 重构

- `c9563b4` refactor: tmux 操作从 execFileSync 改为 async execFile
- `107a12e` refactor: 提取共享类型包 cli-online-shared

### Bug 修复

- `de51461` fix: 修复恢复 session 后分屏按钮创建重名终端的 bug
- `4406bc4` fix: 侧边栏即时刷新 + 终端标题栏显示自定义名称
- `4100dae` fix: 修复 session API 请求路径，使用相对路径走 Vite 代理

### Session 管理侧边栏

- `64a7c00` feat: 添加右侧可折叠 Session 管理侧边栏

## v0.3.0 (2026-02-06)

### 滚动历史回看

- `2f46654` feat: capture-pane 滚动历史使用 xterm.js 只读查看器保留颜色
- `219a1bf` feat: 实现基于 tmux capture-pane 的滚动历史回看功能
- `05edf60` revert: 移除实时 viewer 模式，保留手动 scrollback 查看
- `fc96395` feat: 添加 viewer 模式 - 分离输入/输出的 capture-pane 实时查看器
- `8d3159a` fix: 移除 tmux alternate screen 覆盖, 优化 viewer 刷新为节流

### 终端适配修复

- `fa934e2` fix: 修复终端初次加载行数不足的竞态条件
- `04be88d` fix: 增强 xterm.js 初始 fit 时序，添加延迟重试
- `b55fb14` fix: 启用终端滚动回看 + 首屏自适应填满
- `7540759` refactor: 移除 capture-pane 覆盖层，保留 stripAltScreen 原生滚动

### 文档

- `92cee69` docs: 更新 CLAUDE.md 反映分屏布局和滚动回看功能

## v0.2.0 (2026-02-06)

### 核心架构迁移

- `45c5606` feat: 迁移到 xterm.js + tmux 纯终端模式
- `eb388a5` feat: 支持树形分割布局(水平+垂直) + 终端滚动回看

## v0.1.0 (2026-02-05)

### 初始开发

- `9d66b8e` feat: 实现阶段一 MVP - Claude Code Web Assistant
- `b1c62bf` feat: 添加 Token 认证保护
- `e5155e4` feat: 添加 HTTPS 支持防止 Token 明文传输
- `84603b4` feat: 升级到 node-pty 实现更稳定的 CLI 交互
- `d84a5d3` feat: 实现会话级别的工作目录
- `5421ed8` feat: 添加斜杠命令系统和清理会话功能
- `caa6d55` feat: 实现阶段二 - Session 续接 + 实时流式输出
- `7905cc4` feat: 增强 Markdown 渲染和流式输出

### Bug 修复

- `8aee9fb` fix: 修复 WebSocket 流式输出不显示的问题
- `c9944d7` fix: 修复 Claude CLI 调用参数错误
- `bd50801` fix: 修复 Claude CLI spawn 输出捕获问题

### 项目初始化

- `85baf10` 初始化项目: 添加 .gitignore 和参考项目文档
