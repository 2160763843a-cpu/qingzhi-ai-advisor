#!/usr/bin/env bash
# =============================================================
# 青智家 AI 顾问 - 启动脚本
# 退出码约定: 0 = 服务已在运行或启动成功; 2 = 启动失败
# =============================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-3000}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
LOG_FILE="$SCRIPT_DIR/logs/server.log"

if ! command -v curl >/dev/null; then
  echo "[start] ERROR: curl not found, cannot perform health check"
  exit 2
fi

# 1) 校验是否已启动: 健康检查通过则直接返回 0
if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "[start] service already running on port ${PORT}, nothing to do"
  exit 0
fi

# 2) 清理残留旧进程: 通过 stop.sh 按端口精确终止,
#    避免 kill 单个 PID 后子进程残留继续占用端口
bash "$SCRIPT_DIR/stop.sh"

# 3) 启动前清理构建缓存与依赖检查
#    (当前为纯后端静态服务, 无构建产物缓存; 后续引入前端构建后,
#     在此清理 dist/ 下的构建缓存再重新构建)
if [ ! -d "$SCRIPT_DIR/node_modules/express" ]; then
  echo "[start] node_modules missing, installing dependencies..."
  if ! npm install --no-audit --no-fund; then
    echo "[start] ERROR: npm install failed"
    exit 2
  fi
fi

# 4) 启动服务 (生产模式, 显式限制运行时内存防 OOM):
#    环境变量必须先 export 再执行 nohup,
#    "nohup VAR=value node server.mjs" 会把 VAR=value 当命令名执行导致失败
mkdir -p "$SCRIPT_DIR/logs"
export NODE_ENV=production
export PORT
nohup node --max-old-space-size=512 "$SCRIPT_DIR/server.mjs" >> "$LOG_FILE" 2>&1 &
SERVER_PID=$!
echo "[start] launching server (pid=${SERVER_PID}, port=${PORT}, NODE_ENV=production)..."

# 5) 有界就绪轮询: 最多等待 30 秒;
#    服务进程本身由 nohup 常驻运行, 全程未使用 timeout 包裹
for _ in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "[start] service is up: http://127.0.0.1:${PORT}/"
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[start] ERROR: server process exited unexpectedly, last log lines:"
    tail -n 20 "$LOG_FILE"
    exit 2
  fi
  sleep 1
done

echo "[start] ERROR: service did not become healthy within 30s, last log lines:"
tail -n 20 "$LOG_FILE"
exit 2
