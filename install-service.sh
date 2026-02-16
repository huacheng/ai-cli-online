#!/usr/bin/env bash
set -euo pipefail

# ============================================
#  AI-CLI-Online systemd 服务安装脚本
#  用法: sudo bash install-service.sh
# ============================================

SERVICE_NAME="ai-cli-online"
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
echo "  AI-CLI-Online 服务安装"
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
Description=AI-CLI-Online Web Terminal
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
ProtectSystem=full
PrivateTmp=false

[Install]
WantedBy=multi-user.target
EOF

echo "[完成] 已写入 $SERVICE_FILE"

# --- 启用服务 ---

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "================================"
echo "  systemd 服务安装完成"
echo "================================"
echo ""

# ==========================================================
#  可选: nginx 反向代理配置
# ==========================================================

SETUP_NGINX="n"
if command -v nginx &>/dev/null; then
  echo ""
  echo "检测到 nginx 已安装，是否配置反向代理?"
  echo "  - 自动生成 nginx 站点配置"
  echo "  - 自动设置 WebSocket 代理"
  echo "  - 自动设置 HTTPS_ENABLED=false (由 nginx 做 SSL 终端)"
  echo ""
  if [[ "${1:-}" == "-y" ]]; then
    SETUP_NGINX="y"
  else
    read -rp "配置 nginx 反向代理? [y/N] " SETUP_NGINX
  fi
fi

if [[ "$SETUP_NGINX" =~ ^[Yy] ]]; then
  # 读取端口 (从 .env 或默认 3001)
  BACKEND_PORT="3001"
  ENV_FILE="${PROJECT_DIR}/server/.env"
  if [[ -f "$ENV_FILE" ]]; then
    ENV_PORT=$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d ' "'"'" || true)
    if [[ -n "$ENV_PORT" ]]; then
      BACKEND_PORT="$ENV_PORT"
    fi
  fi

  # 交互获取域名
  read -rp "域名 (留空则使用 _ 匹配所有): " NGINX_DOMAIN
  NGINX_DOMAIN="${NGINX_DOMAIN:-_}"

  # 交互获取监听端口
  read -rp "nginx 监听端口 [443]: " NGINX_LISTEN_PORT
  NGINX_LISTEN_PORT="${NGINX_LISTEN_PORT:-443}"

  # SSL 配置
  NGINX_SSL_BLOCK=""
  if [[ "$NGINX_LISTEN_PORT" == "443" ]]; then
    echo ""
    echo "SSL 证书配置:"
    echo "  1) 已有证书 (输入路径)"
    echo "  2) 自签名证书 (自动生成)"
    echo "  3) 不使用 SSL (改为监听 80 端口)"
    read -rp "选择 [1/2/3]: " SSL_CHOICE

    case "${SSL_CHOICE:-1}" in
      1)
        read -rp "证书文件路径 (.crt/.pem): " SSL_CERT
        read -rp "私钥文件路径 (.key): " SSL_KEY
        if [[ ! -f "$SSL_CERT" || ! -f "$SSL_KEY" ]]; then
          echo "[错误] 证书或私钥文件不存在"
          exit 1
        fi
        NGINX_SSL_BLOCK="    ssl_certificate     ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;"
        ;;
      2)
        SELF_SIGN_DIR="/etc/nginx/ssl"
        mkdir -p "$SELF_SIGN_DIR"
        SELF_CERT="${SELF_SIGN_DIR}/${SERVICE_NAME}.crt"
        SELF_KEY="${SELF_SIGN_DIR}/${SERVICE_NAME}.key"
        echo "[SSL] 生成自签名证书..."
        openssl req -x509 -nodes -days 3650 \
          -newkey rsa:2048 \
          -keyout "$SELF_KEY" \
          -out "$SELF_CERT" \
          -subj "/CN=${NGINX_DOMAIN}" \
          2>/dev/null
        echo "[SSL] 证书: $SELF_CERT"
        echo "[SSL] 私钥: $SELF_KEY"
        NGINX_SSL_BLOCK="    ssl_certificate     ${SELF_CERT};
    ssl_certificate_key ${SELF_KEY};
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;"
        ;;
      3)
        NGINX_LISTEN_PORT="80"
        ;;
    esac
  fi

  # 构建 listen 指令
  if [[ -n "$NGINX_SSL_BLOCK" ]]; then
    LISTEN_DIRECTIVE="listen ${NGINX_LISTEN_PORT} ssl;"
  else
    LISTEN_DIRECTIVE="listen ${NGINX_LISTEN_PORT};"
  fi

  # 生成 nginx 配置
  NGINX_CONF="/etc/nginx/sites-available/${SERVICE_NAME}"
  cat > "$NGINX_CONF" <<NGINX_EOF
# AI-CLI-Online nginx reverse proxy
# Auto-generated by install-service.sh

server {
    ${LISTEN_DIRECTIVE}
    server_name ${NGINX_DOMAIN};

${NGINX_SSL_BLOCK}

    # 文件上传大小限制 (与 multer 100MB 限制匹配)
    client_max_body_size 100m;

    # Static files served directly by nginx (fonts, JS, CSS, images)
    # Avoids proxy buffering issues with large files like 5MB+ fonts
    location /assets/ {
        alias ${PROJECT_DIR}/web/dist/assets/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        gzip_static on;
    }

    location /fonts/ {
        alias ${PROJECT_DIR}/web/dist/fonts/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location /favicon.svg {
        alias ${PROJECT_DIR}/web/dist/favicon.svg;
        expires 30d;
    }

    # API, WebSocket, and HTML via Node.js proxy
    location / {
        proxy_pass http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400s;
    }
}
NGINX_EOF

  echo "[nginx] 已写入 $NGINX_CONF"

  # Ensure nginx worker (www-data) can traverse user home directory for static files
  chmod o+x "$RUN_HOME"
  echo "[nginx] 已设置 $RUN_HOME 可遍历权限 (chmod o+x)"

  # 启用站点 (symlink to sites-enabled)
  NGINX_ENABLED="/etc/nginx/sites-enabled/${SERVICE_NAME}"
  if [[ -L "$NGINX_ENABLED" ]]; then
    rm "$NGINX_ENABLED"
  fi
  ln -s "$NGINX_CONF" "$NGINX_ENABLED"
  echo "[nginx] 已启用站点"

  # 设置 server/.env 的 HTTPS_ENABLED=false 和 TRUST_PROXY=1
  if [[ -f "$ENV_FILE" ]]; then
    # 更新已有的 HTTPS_ENABLED
    if grep -q '^HTTPS_ENABLED=' "$ENV_FILE"; then
      sed -i 's/^HTTPS_ENABLED=.*/HTTPS_ENABLED=false/' "$ENV_FILE"
    else
      echo 'HTTPS_ENABLED=false' >> "$ENV_FILE"
    fi
    # 更新已有的 TRUST_PROXY
    if grep -q '^TRUST_PROXY=' "$ENV_FILE"; then
      sed -i 's/^TRUST_PROXY=.*/TRUST_PROXY=1/' "$ENV_FILE"
    else
      echo 'TRUST_PROXY=1' >> "$ENV_FILE"
    fi
    echo "[env] 已设置 HTTPS_ENABLED=false, TRUST_PROXY=1"
  else
    cat > "$ENV_FILE" <<ENV_EOF
PORT=${BACKEND_PORT}
HOST=0.0.0.0
HTTPS_ENABLED=false
TRUST_PROXY=1
AUTH_TOKEN=
DEFAULT_WORKING_DIR=${RUN_HOME}
ENV_EOF
    chown "$RUN_USER:$RUN_USER" "$ENV_FILE" 2>/dev/null || true
    echo "[env] 已创建 $ENV_FILE (HTTPS_ENABLED=false, TRUST_PROXY=1)"
  fi

  # 测试 nginx 配置
  echo "[nginx] 测试配置..."
  if nginx -t 2>&1; then
    systemctl reload nginx
    echo "[nginx] 配置已生效"
  else
    echo "[警告] nginx 配置测试失败，请手动检查: $NGINX_CONF"
  fi

  echo ""
  echo "================================"
  echo "  nginx 反向代理配置完成"
  echo "================================"
  echo ""
  if [[ -n "$NGINX_SSL_BLOCK" ]]; then
    echo "  访问地址:   https://${NGINX_DOMAIN}:${NGINX_LISTEN_PORT}"
  else
    echo "  访问地址:   http://${NGINX_DOMAIN}:${NGINX_LISTEN_PORT}"
  fi
  echo "  后端端口:   ${BACKEND_PORT}"
  echo "  站点配置:   $NGINX_CONF"
  echo ""
  echo "  卸载 nginx 配置:"
  echo "    sudo rm ${NGINX_ENABLED} ${NGINX_CONF} && sudo nginx -s reload"
  echo ""
fi

# --- 最终提示 ---

echo "================================"
echo "  常用命令"
echo "================================"
echo ""
echo "  启动服务:   sudo systemctl start $SERVICE_NAME"
echo "  查看状态:   sudo systemctl status $SERVICE_NAME"
echo "  查看日志:   sudo journalctl -u $SERVICE_NAME -f"
echo "  停止服务:   sudo systemctl stop $SERVICE_NAME"
echo "  卸载服务:   sudo systemctl disable $SERVICE_NAME && sudo rm $SERVICE_FILE"
echo ""
