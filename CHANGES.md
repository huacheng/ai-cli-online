# AI-CLI-Online 变更日志

## v2.1.1 (2026-02-08)

### 文档

- `743c0c5` docs: README 补充适用场景说明 — 网络不稳定/SSH 断线场景 + 本地有状态终端
- 同步更新英文版 (README.md) 和中文版 (README.zh-CN.md)

### 发布

- npm 包发布至 https://www.npmjs.com/package/ai-cli-online
- GitHub Release 发布至 https://github.com/huacheng/ai-cli-online/releases/tag/v2.1.1

## v2.1.0 (2026-02-08)

### 新功能

- `80fbc8d` feat: 全局字体大小设置 — 服务端持久化 + 终端实时响应
  - 新增 `settings` 表 (token_hash + key 复合主键) 存储用户偏好
  - 前端 header 添加 A−/A+ 字体大小控制 (范围 10-24)
  - 终端和滚动历史回看器实时响应字体变更
  - 设置按 token 隔离，通过 REST API 持久化到 SQLite

### 配置

- `285fd20` docs: `.env.example` 添加 `TRUST_PROXY` 配置项说明

### 发布

- npm 包发布至 https://www.npmjs.com/package/ai-cli-online
- GitHub 仓库发布至 https://github.com/huacheng/ai-cli-online

## v2.0.0 (2026-02-08)

### BREAKING: 包名变更

- 包名从 `cli-online` 更名为 `ai-cli-online`
- 所有 workspace 包同步重命名 (`ai-cli-online-shared`, `ai-cli-online-server`, `ai-cli-online-web`)
- bin 入口从 `cli-online` 更名为 `ai-cli-online`
- GitHub 仓库迁移至 `huacheng/ai-cli-online`
- localStorage key、tmux session 前缀、SQLite 数据库文件名等全部同步更新

### 新功能

- nginx 反向代理自动配置 — `install-service.sh` 检测 nginx 后交互式引导配置（域名、端口、SSL），自动生成站点配置、设置 WebSocket 代理和 `HTTPS_ENABLED=false`

### 文档

- README 重写为英文主版本 (`README.md`) + 中文版本 (`README.zh-CN.md`)
- 新增 AI-Cli Online vs OpenClaw 18 维度功能对比表

## v1.5.0 (2026-02-08)

### 网络连接延迟优化

- `99b72c8` perf: resize debounce 降至 50ms + PTY/tmux resize 并行
- `6147e35` perf: session 初始化并行化 + 重连 jitter
- `d102046` perf: 修复连接状态时序 + 消除 sendBinary 双重 Buffer 分配

## v1.4.1 (2026-02-08)

### UI 修复

- `f894382` fix: 将 Send 按钮移至 DocBrowser 工具栏，与 Open 按钮齐平

## v1.4.0 (2026-02-08)

### 文档浏览器 (DocBrowser)

- `a095a7a` feat: PlanPanel 改造为通用文档浏览器 (DocBrowser)
  - 支持 Markdown / HTML / PDF 三种格式
  - DocumentPicker 按扩展名过滤文档文件
  - 文件变更通过 mtime 轮询检测，支持 304 未修改优化

### Bug 修复

- `d11641f` fix: 终端面板关闭按钮同步销毁 tmux session

## v1.3.0 (2026-02-07)

### Tab 多标签页系统

- `50a0b62` refactor: Plan 面板解耦 Claude 启动关联，由用户自行决定启动什么 CLI
- `9a0243e` fix: 修复 xterm.js 字体渲染大小不一致问题
  - TabBar 组件: 新增 / 切换 / 关闭 / 双击重命名
  - 每个 Tab 拥有独立终端列表和布局树
  - Tab 状态序列化到 localStorage，刷新后恢复

## v1.2.1 (2026-02-07)

### Plan 面板项目级关联 + 代码优化

- `06205ed` fix: Plan 面板按终端 CWD 关联项目计划文件，而非全局最新
- `6880970` refactor: plans.ts 代码流程优化 — 消除重复、提取通用查找、常量提升
- `6bc478e` refactor: 全局代码优化 — 消除重复、提升类型安全与性能
- `82ec340` perf: 编辑器渲染器性能优化 + 第二轮代码清理

## v1.2.0 (2026-02-07)

### Plan 面板 + 斜杠命令提示

- `7265f23` feat: Plan 面板 — 左侧 plan 文件渲染器 + 右侧编辑器 + 斜杠命令提示
  - MarkdownRenderer + MarkdownEditor 组件
  - PdfRenderer 组件
  - 编辑器支持多行编辑后合并为单行发送到终端
- `797a2e4` feat: 编辑器草稿 SQLite 服务端持久化，支持跨刷新恢复
  - 后端 better-sqlite3 (WAL 模式) 存储草稿
  - drafts REST API (GET/PUT)
- `c7bbddc` feat: 添加文本编辑器面板，支持多行编辑后合并为单行发送到终端

## v1.1.1 (2026-02-07)

### 审计修复

- `de5caf4` fix: 第三轮全局审计修复 — 性能、健壮性、可访问性提升

### 运维

- `5deb1ee` ops: 添加 systemd service 配置，支持开机自启与进程管理

## v1.1.0 (2026-02-07)

### 安全加固 + 品牌重命名 + 网络优化

- `090e4be` perf: 高延迟网络下 WebSocket 连接稳定性与输入延迟优化
- `8af75b4` chore: 品牌名称改为 AI-Cli Online
- `a35784b` fix: 第二轮全局审计修复 — 安全加固、可靠性、UX 增强
- `319e759` security: 修复 P0/P1 安全漏洞与可靠性问题
- `81ebc20` fix: start.sh 从 server/ 目录启动，确保 dotenv 读取 .env
- `bf46a26` style: UI 美化 — 移除 Google Fonts 远程引用 + 全局样式优化
- `fba44c1` fix: 修复 P3 建议 — selector 优化、scrollback 节流、字体与竞态
- `d12c52c` fix: 修复 P2 改进问题 — 性能、安全姿态、解析一致性

### 文件传输

- `0f79d53` feat: 文件上传下载功能 — 每个终端面板支持上传文件到 CWD 和浏览/下载文件
  - 后端新增 4 个 REST API: cwd / files / upload / download
  - 前端 FileBrowser 覆盖层组件 (目录导航 + 文件下载)
  - TerminalPane 标题栏新增上传(↑)和文件浏览(↓)按钮
  - multer 处理 multipart 上传, copyFile+unlink 支持跨文件系统

### 性能优化

- `4ead1e0` perf: xterm 响应速度全面优化 + 全局网络状态指示器
- `db84b8e` release: v1.0.4 — xterm 性能优化 + 网络状态指示器

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
- `107a12e` refactor: 提取共享类型包 ai-cli-online-shared

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
