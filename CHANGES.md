# AI-CLI-Online 变更日志

## v2.9.0 (2026-02-12)

### 新功能

- **中文等宽字体 LXGW WenKai Mono** — 通过 jsDelivr CDN 加载霞鹜文楷等宽字体，unicode-range 分片按需加载（116 个 woff2 chunks），浏览器仅下载页面实际用到的 CJK 字符分片，npm 包体积零增长
  - 字体栈: JetBrains Mono (Latin) → LXGW WenKai Mono (CJK) → 系统回退
  - CSP 安全策略更新: `styleSrc` 和 `fontSrc` 允许 `cdn.jsdelivr.net`
  - 全局 font-family 统一更新（index.css 7 处 + TerminalView FONT_FAMILY）

### 文档

- 清理 README 过期信息: 移除已删除的文档浏览器、PDF 懒加载等描述
- 更新功能对比表 Canvas/UI 列和包大小（~1 MB）
- 移除 33 行废弃 CSS（`.pdf-renderer`、`.doc-expanded-overlay`）

## v2.8.0 (2026-02-12)

### 新功能

- **批注类型扩展为 4 种** — 从 2 种 (insert/delete) 扩展到 4 种完整批注体系:
  - **Insert** (`+` 黄色): 行间插入批注（现有）
  - **Delete** (`−` 红色): 选中文本删除（现有）
  - **Replace** (`↔` 蓝色): 选中文本替换，卡片显示 "old → new"（新增）
  - **Comment** (`?` 绿色): 选中文本评注/提问（新增）
- **浮动按钮组** — 选中文本后弹出 3 按钮竖排面板 (`−` / `↔` / `?`)，替代原来的单个删除按钮
- **Replace/Comment 卡片渲染** — 蓝色/绿色边框卡片，支持双击编辑、单条发送、删除
- **选区视觉反馈** — Replace 蓝色左边框、Comment 绿色左边框，与 Delete 红色左边框风格一致
- **/aicli-task-review 命令扩展** — JSON 输出包含 4 种 Annotations 数组；新增 Replace (Section C) 和 Comment (Section D) 处理逻辑；Comment 智能区分问句型（研究 + 解释）和陈述型（记录备忘）

### 兼容性

- 旧版批注数据（仅含 additions/deletions）自动迁移，新增 replacements/comments 空数组

## v2.7.0 (2026-02-12)

### 安全加固

- **symlink 穿越防护** — 文件下载 API 增加 `lstat` + `realpath` 双重校验，阻止符号链接逃逸访问敏感文件
- **未认证 WebSocket 限制** — 未通过认证的 WebSocket 连接 10 秒超时自动断开
- **TOCTOU 下载防护** — 下载时先 `lstat` 再 `createReadStream`，防止检查与使用之间的竞态条件
- **CSP Headers 增强** — 新增 `frame-ancestors 'none'`、`base-uri 'self'`、`form-action 'self'` 安全指令

### 代码质量

- 全局 TypeScript strict 模式修复
- 消除未使用变量和 import
- 错误处理统一化

### 性能

- WebSocket 消息处理优化
- 服务端响应压缩配置调优

## v2.6.0 (2026-02-11)

### 新功能

- **2D 网格面板布局** — TerminalPane 重构为 [Plan | Xterm] + [Chat] 三区域同时显示，Plan 左侧全高、Chat 底部，分隔条可拖拽调整比例（持久化 localStorage）
- **Plan/Chat 面板开关统一** — Xterm Header 按钮独立控制 Plan 和 Chat 面板的显隐，两者可同时打开
- **Plan 文件浏览器** (PlanFileBrowser) — 左侧目录树浏览 TASK/ 目录下的 `.md` 文件，支持新建文件、删除文件、路径尾部优先显示、父目录名标注
- **批注发送 /aicli-task-review 命令** — 批注 Send 按钮生成 `/aicli-task-review` 斜杠命令（含文件路径 + JSON 批注），直接发送到终端由 Claude 处理
- **批注服务端持久化** — 批注从 localStorage 迁移到 SQLite（`annotations` 表），通过 REST API（`GET/PUT /api/sessions/:sessionId/annotations`）读写，支持跨浏览器同步
- **Markdown 目录导航** (MarkdownToc) — 从 Markdown heading 提取锚点，右侧目录面板快速跳转
- **文件删除 API** — `DELETE /api/sessions/:sessionId/rm` 支持删除文件和递归删除目录
- **CWD 打包下载** — `GET /api/sessions/:sessionId/download-cwd` tar.gz 流式下载当前工作目录
- **空文件占位提示** — Plan 面板空文件显示占位提示
- **Light/Dark 主题系统** — CSS 变量双主题，19 个语义变量，xterm.js 终端同步切换，VSCode 风格配色

### 修复

- **files API 路径校验** — `validatePath` 对 `~/.claude/commands` 等 HOME 下路径误拒（不在 CWD 下），增加 HOME 目录回退校验
- **编辑批注时间隙按钮误弹** — 编辑批注时抑制其他行 InsertZone (+) 按钮的 hover 弹出
- **右键粘贴 fallback** — 从 `execCommand('paste')` 改为 paste 事件捕获，兼容性更好
- **CSP img-src 缺少 blob:** — 导致图片渲染被浏览器拦截

### 重构

- **/task-review → /aicli-task-review** — 自定义斜杠命令重命名，增加 `aicli-` 前缀避免与其他项目命令重名
- **UI 大重构** — 删除 DocumentPicker、FileBrowser、FileListShared、MarkdownRenderer、PdfRenderer、VirtualTextRenderer、useFileBrowser、useHorizontalResize 等旧组件，代码量 -1910 +2607 行
- **硬编码颜色迁移** — 所有组件颜色统一使用 CSS 变量 `var(--xxx)`，分割线细化

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.6.0
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.6.0

## v2.4.0 (2026-02-10)

### 新功能

- **Mermaid 图表渲染** — Markdown 文档中的 mermaid/gantt 代码块内联渲染为 SVG 图表，暗色主题适配 Tokyo Night 配色
  - CDN 懒加载: jsdelivr 主源 + unpkg 备源，加载失败重置 promise 允许重试
  - CSP `scriptSrc` 白名单 `cdn.jsdelivr.net` 和 `unpkg.com`
  - 共享 `useMermaidRender` hook，MarkdownRenderer 和 PlanAnnotationRenderer 复用
- **Plan 批注系统** — 文档内容内联批注，支持新增/编辑/删除，持久化存储
  - 基线过滤 + 防闪烁 + 双实例修复
  - 面板模式持久化 (panelMode localStorage)
- **鼠标选中自动复制 + 右键粘贴** — 终端剪贴板集成
- **编辑器 undo 撤销栈** — 编辑器支持撤销操作
- **斜杠命令增强** — `/history` 历史回看、冒号分隔符支持、蓝紫色统一标识
- **tmux 固定 socket 路径** — 服务重启后 tmux server 存活，自动重连恢复会话
- **fillContent API** — 编辑器内容填充接口

### 修复

- **CSP 拦截 CDN 动态 import** — helmet `scriptSrc` 仅 `'self'` 导致 mermaid CDN 加载被浏览器阻止
- **mermaid 循环依赖** — MarkdownRenderer ↔ useMermaidRender ESM 循环引用导致 `loadMermaid` 为 undefined
- **CDN 失败静默吞错** — loadMermaid 失败后 promise 缓存 rejected 结果，后续调用永远失败
- **Open 打开文件污染 Plan 编辑器** — 文档切换时编辑器内容隔离

### 重构

- **提取 `useMermaidRender` hook** — 消除 MarkdownRenderer 和 PlanAnnotationRenderer ~50 行重复 mermaid 渲染逻辑
- **消除 `formatSize`/`fileIcon` 重复** — 统一到 `utils.ts`，删除 PlanPanel 和 DocumentPicker 本地副本
- **CSS class 提取** — `.mermaid-error`、`.pane-btn--sm` 替代内联样式
- **`useTextareaKit` 共享逻辑** — 编辑器通用行为提取

### 性能

- **WebSocket 输入批处理间隔** — 从 5ms 调整为 10ms

## v2.3.2 (2026-02-09)

### 修复

- **tmux 状态栏未隐藏** — `set-option -t =${name}` 的 `=` 精确匹配前缀对 `set-option`/`show-options` 命令无效（返回 "no such session"），导致 `status off` 等配置静默失败。修复：`set-option` 改用裸 session 名；提取 `configureSession()` 函数；恢复已有 session 时也重新应用配置

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.3.2
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.3.2

## v2.3.1 (2026-02-09)

### 改进

- **终端关闭按钮移至侧边栏** — 移除 TerminalPane 标题栏的 [×] 关闭按钮（防止误点击），改为在 SessionSidebar 展开的终端列表中提供 [×] 按钮，点击前弹出确认弹窗

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.3.1
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.3.1

## v2.2.6 (2026-02-09)

### 修复

- **[BUG] scrollback history 无内容** — `tmux capture-pane -t =${name}` 的 `=` 精确匹配前缀对 pane 级命令无效，改为 `=${name}:` 格式（尾部冒号指定当前活动 pane），保留精确匹配防止会话串线
- **ScrollbackViewer 渲染失败** — 加载 WebGL 渲染器（与主终端一致）；布局从 flex 改为 absolute 定位确保容器有确定尺寸；fit 增加 interval 重试机制
- **ESC 关闭 scrollback 失效** — xterm.js 即使 `disableStdin: true` 仍拦截键盘事件，通过 `attachCustomKeyEventHandler` 在 xterm 层直接拦截 ESC
- **空格键误触发 scrollback** — scrollback 按钮添加 `tabIndex={-1}` + click 后 `blur()`，防止焦点残留导致空格键激活

### 功能

- **文件列表显示大小** — DocumentPicker 和 InlineDocBrowser 文件列表增加文件大小显示（B / KB / MB 智能格式化）

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.2.6
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.2.6

## v2.2.5 (2026-02-09)

### 重构

- **stale session 批量清理** — `cleanupStaleSessions` 改为 `Promise.all` 并行 kill，避免串行阻塞
- **listFiles 并发限制** — stat 调用分 50 个一批处理，防止大目录耗尽文件描述符
- **终端移除逻辑去重** — 提取 `removeTerminalFromState` 共享函数，消除 `removeTerminal`/`killServerSession` 重复代码

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.2.5
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.2.5

## v2.2.4 (2026-02-09)

### 性能

- **matchMedia 替代 resize 监听** — `useWindowWidth` 改为 `useIsNarrow` (matchMedia)，N 个终端共享单个阈值监听器，消除重复 resize 事件
- **Zustand selector 优化** — SessionSidebar 关闭时跳过 tabs/serverSessions 订阅；`terminalIds.length` 替代数组引用避免无效 effect 触发
- **Chunk 修正** — `@xterm/addon-web-links` 归入 terminal manualChunk，index chunk 减小 2.5KB

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.2.4
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.2.4

## v2.2.3 (2026-02-09)

### 安全

- **[CRITICAL] iframe sandbox 加固** — 移除文档浏览器 HTML iframe 的 `allow-same-origin` 属性，防止恶意 HTML 文件通过同源访问窃取 localStorage 中的 auth token

### 性能

- **PDF 懒加载** — `pdfjs-dist` (445KB / 131KB gzip) 改为首次打开 PDF 时才动态加载，不再在模块导入时立即触发
- **tmux set-option 合并** — 3 次独立子进程调用合并为单次 tmux 调用（`;` 分隔符）

### 稳定性

- **tmux execFile 超时保护** — 所有 tmux 子进程调用增加 5 秒超时，防止 tmux 挂起导致 Node.js 事件循环无限阻塞

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.2.3
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.2.3

## v2.2.2 (2026-02-09)

### 优化

- **移除 Maple Mono CN 字体** — 删除 ~11MB 的 MapleMono woff2 字体文件，统一使用 JetBrains Mono
- 清理所有 `@font-face` 声明和 `font-family` 引用
- npm 包体积从 ~12MB 降至 ~948KB

### 发布

- npm: https://www.npmjs.com/package/ai-cli-online/v/2.2.2
- GitHub Release: https://github.com/huacheng/ai-cli-online/releases/tag/v2.2.2

## v2.2.1 (2026-02-08)

### 修复

- **tmux CWD 查询失效** — `display-message` 不支持 `=` 精确匹配前缀导致 `getCwd`/`getPaneCommand` 静默返回空字符串，改用 `list-panes -F` 替代，保留精确匹配防止 session 串线
- **xterm 加载延迟** — 移除 `document.fonts.ready` 门控（11MB 中文字体可能需 90+ 秒），改为立即创建终端 + 字体就绪后 re-fit
- **restoreFromServer 覆盖连接状态** — 服务端恢复时保留已建立的 WebSocket 连接状态，防止 xterm 白屏
- **大字体 preload 警告** — 移除 5MB+ Maple Mono CN 的 preload 标签，仅保留 92KB JetBrains Mono

### 改进

- **install-service.sh nginx 配置** — 新增 `/assets/`、`/fonts/`、`/favicon.svg` 静态文件直接由 nginx 服务，避免 proxy buffering 截断大文件；合并 WebSocket location；自动设置 `chmod o+x` 用户目录

## v2.2.0 (2026-02-08)

### 新功能

- Tab 布局服务端持久化 — 复用 settings 表 (key=`tabs-layout`) 存储完整布局 JSON，换浏览器/清缓存后可从服务端恢复
- 两阶段恢复 — 登录时先从 localStorage 快速渲染，再异步从服务端获取布局并与 tmux session 对账，自动移除已死终端
- 页面关闭时通过 `sendBeacon` 刷出待保存布局，防止丢失
- 文档浏览器支持所有文件类型 — 移除文件扩展名过滤，新增纯文本 fallback 渲染器
- useFileBrowser 新增 CWD 轮询 — 终端切换目录时文档浏览器自动刷新文件列表

### 修复

- tmux 命令统一使用 `=` 前缀精确匹配 session 名称，避免前缀歧义导致误操作

### 文档

- README 中英文版同步截图和摘要格式

### 发布

- npm 包发布至 https://www.npmjs.com/package/ai-cli-online
- GitHub Release 发布至 https://github.com/huacheng/ai-cli-online/releases/tag/v2.2.0

## v2.1.3 (2026-02-08)

### 安全

- CSP 添加 imgSrc 指令，允许 HTTPS 和 data: 协议图片
- DOMPurify 配置白名单 img 标签及 src/alt/title/width/height 属性
- 登录表单添加 `autoComplete="current-password"` 消除浏览器警告

### 性能

- WebSocket 背压控制 — 基于 `bufferedAmount` 的 PTY pause/resume 流控 (1MB 高水位)
- REST API 分层限速 — 读端点 180/min、写端点 60/min，参数可通过 .env 配置
- 优雅停机 — 500ms 延迟确保 PTY 清理完成
- 启动时清理过期草稿，避免累积

### 体验

- 文档浏览器空状态改为显示当前目录文件列表，点击即打开
- DocumentPicker 弹窗限定在渲染器区域，不再遮挡编辑器
- Markdown 编辑器支持 `@` 文件选择器自动补全
- 小屏 (<600px) 自动将水平分屏降级为垂直分屏
- 终端未连接时显示 "Connecting..." 覆盖层
- 侧边栏 z-index 修复，不再被终端 WebGL 层遮挡

### 后端

- `listFiles` 返回 `{ files, truncated }` 结构，目录条目上限 1000
- 文件目录上限截断后通过 `truncated` 字段告知前端

### 文档

- README 添加截图 + 精简描述

### 发布

- npm 包发布至 https://www.npmjs.com/package/ai-cli-online
- GitHub Release 发布至 https://github.com/huacheng/ai-cli-online/releases/tag/v2.1.3

## v2.1.2 (2026-02-08)

### 性能优化

- Vite manualChunks 拆分 vendor bundle，主包 720KB → 71KB (减少 90%)
- TabBar / SessionSidebar 改用细粒度 Zustand selector，消除不必要重渲染
- saveFontSize 添加 debounce，ScrollbackViewer 字号变更原地更新
- 添加 compression 中间件压缩 HTTP 响应

### 稳定性

- 添加 `process.on('unhandledRejection')` 防止服务端静默崩溃
- 每个终端面板包裹 ErrorBoundary，单面板崩溃不影响全局
- `resizeSession` 添加 `.catch()` 防止未处理 rejection
- shutdown 时清理所有 setInterval 句柄，支持优雅关闭
- 静默 catch 块添加日志输出 (5 处)

### 代码质量

- 抽取 `useFileBrowser` hook + `FileListShared` 组件，消除 FileBrowser/DocumentPicker ~80% 重复代码
- 抽取 `useHorizontalResize` hook，PlanPanel resize 逻辑可复用

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
