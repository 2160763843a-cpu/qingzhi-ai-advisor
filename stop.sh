#!/usr/bin/env bash
# =============================================================
# 青智家 AI 顾问 - 停止脚本
# 通过 ss 提取监听端口的进程 PID 并终止;
# 未使用 fuser/lsof (环境中不一定存在);
# 未吞掉 stderr (避免 command not found 被静默掩盖)
# =============================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3000}"

# 提取所有监听该端口的 PID (兼容 IPv4/IPv6 行, 去重)
PIDS="$(ss -tlnp | grep ":${PORT} " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"

if [ -z "$PIDS" ]; then
  echo "[stop] no process listening on port ${PORT}"
  exit 0
fi

echo "[stop] sending SIGTERM to pid(s): $(echo "$PIDS" | tr '\n' ' ')"
for pid in $PIDS; do
  kill "$pid"
done

# 等待端口释放, 最多 10 秒
for _ in $(seq 1 10); do
  if ! ss -tln | grep -q ":${PORT} "; then
    echo "[stop] service stopped, port ${PORT} released"
    exit 0
  fi
  sleep 1
done

# 宽限期结束仍在监听则强制终止
PIDS="$(ss -tlnp | grep ":${PORT} " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)"
if [ -n "$PIDS" ]; then
  echo "[stop] sending SIGKILL to pid(s): $(echo "$PIDS" | tr '\n' ' ')"
  for pid in $PIDS; do
    kill -9 "$pid"
  done
fi
echo "[stop] service stopped (forced)"
exit 0
