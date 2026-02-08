#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3001}"

echo "================================"
echo "  AI-CLI-Online 启动脚本"
echo "================================"

# 1. 清理占用端口的旧进程
if fuser "$PORT/tcp" >/dev/null 2>&1; then
  echo "[清理] 端口 $PORT 被占用，正在终止旧进程..."
  fuser -k "$PORT/tcp" >/dev/null 2>&1 || true
  sleep 1
  # 如果 SIGTERM 没杀掉，强制 kill
  if fuser "$PORT/tcp" >/dev/null 2>&1; then
    echo "[清理] 旧进程未响应，强制终止..."
    fuser -k -9 "$PORT/tcp" >/dev/null 2>&1 || true
    sleep 1
  fi
  echo "[清理] 旧进程已终止"
else
  echo "[清理] 端口 $PORT 空闲，无需清理"
fi

# 2. 清理残留的 node 子进程（仅限本项目）
pkill -f "node.*ai-cli-online.*dist/index.js" 2>/dev/null || true

# 3. 构建项目
echo "[构建] 编译 server 和 web..."
cd "$PROJECT_DIR"
npm run build 2>&1
echo "[构建] 完成"

# 4. 启动服务（从 server/ 目录启动，确保 dotenv 能读取 server/.env）
echo "[启动] 启动服务 (端口: $PORT)..."
cd "$PROJECT_DIR/server"
exec node dist/index.js
