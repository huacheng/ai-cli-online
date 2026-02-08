#!/usr/bin/env bash
set -euo pipefail

# ============================================
#  CLI-Online systemd 服务安装脚本
#  用法: sudo bash install-service.sh
# ============================================

SERVICE_NAME="cli-online"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# --- 检测环境 ---

# 项目目录 = 脚本所在目录
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 运行用户 (优先 SUDO_USER，回退当前用户)
RUN_USER="${SUDO_USER:-$(whoami)}"
RUN_HOME=$(eval echo "~${RUN_USER}")

# Node.js 路径
NODE_BIN=$(su - "$RUN_USER" -c "which node" 2>/dev/null || true)
if [[ -z "$NODE_BIN" ]]; then
  echo "[错误] 未找到 node，请先安装 Node.js >= 18"
  exit 1
fi
NODE_DIR=$(dirname "$NODE_BIN")
NODE_VERSION=$("$NODE_BIN" --version)

NPM_BIN=$(su - "$RUN_USER" -c "which npm" 2>/dev/null || true)
if [[ -z "$NPM_BIN" ]]; then
  echo "[错误] 未找到 npm"
  exit 1
fi

# 检查 tmux
if ! command -v tmux &>/dev/null; then
  echo "[错误] 未找到 tmux，请先安装: sudo apt install tmux"
  exit 1
fi

# --- 确认信息 ---

echo "================================"
echo "  CLI-Online 服务安装"
echo "================================"
echo ""
echo "  项目目录:  $PROJECT_DIR"
echo "  运行用户:  $RUN_USER"
echo "  Node.js:   $NODE_BIN ($NODE_VERSION)"
echo "  npm:       $NPM_BIN"
echo "  服务文件:  $SERVICE_FILE"
echo ""

# 非交互模式 (传 -y 跳过确认)
if [[ "${1:-}" != "-y" ]]; then
  read -rp "确认安装? [Y/n] " answer
  if [[ "$answer" =~ ^[Nn] ]]; then
    echo "已取消"
    exit 0
  fi
fi

# --- 生成 service 文件 ---

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=CLI-Online Web Terminal
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${PROJECT_DIR}/server
Environment=PATH=${NODE_DIR}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=NODE_ENV=production
EnvironmentFile=-${PROJECT_DIR}/server/.env
ExecStartPre=${NPM_BIN} run --prefix ${PROJECT_DIR} build
ExecStart=${NODE_BIN} dist/index.js
Restart=on-failure
RestartSec=5

# 进程管理
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=10

# 安全加固
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${RUN_HOME}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

echo "[完成] 已写入 $SERVICE_FILE"

# --- 启用服务 ---

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "================================"
echo "  安装完成"
echo "================================"
echo ""
echo "  启动服务:   sudo systemctl start $SERVICE_NAME"
echo "  查看状态:   sudo systemctl status $SERVICE_NAME"
echo "  查看日志:   sudo journalctl -u $SERVICE_NAME -f"
echo "  停止服务:   sudo systemctl stop $SERVICE_NAME"
echo "  卸载服务:   sudo systemctl disable $SERVICE_NAME && sudo rm $SERVICE_FILE"
echo ""
