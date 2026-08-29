#!/bin/bash
# launch.sh — 皮肤版 ZCode 启动器
# 做三件事：完全退出 ZCode → 带调试端口(9343)重启 → 等主窗口出现后自动注入主题
#
# 用法（终端）：  bash launch.sh [主题目录]
# 首次运行会重启 ZCode，打开的会话窗口会关闭，但会话数据都保留，重开即可。

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT=9343
APP_BIN="/Applications/ZCode.app/Contents/MacOS/ZCode"
THEME="${1:-$DIR/themes/default}"
LOG_DIR="$DIR/logs"
LOG="$LOG_DIR/launch-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$LOG_DIR"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$1" | tee -a "$LOG"; }

# 主进程探测：ps comm 精确匹配（pgrep -x "ZCode" 在部分机器上匹配不到主进程）
zcode_running() { ps -eo comm= | grep -qx "ZCode"; }

wait_zcode_exit() {
  local i
  for i in $(seq 1 40); do
    zcode_running || return 0
    sleep 0.25
  done
  return 1
}

log "ZCode 皮肤启动器开始 | 端口 ${PORT} | 主题 ${THEME}"
log "10 秒后开始重启 ZCode（给当前会话留收尾时间）……"
sleep 10

# ---------- 第 1 步：退出 ZCode ----------
log "第 1 步：退出 ZCode……"
osascript -e 'quit app "ZCode"' >>"$LOG" 2>&1 || true
if ! wait_zcode_exit; then
  log "10 秒还没退出，发送强制退出信号……"
  pkill -TERM -x "ZCode" >>"$LOG" 2>&1 || true
  sleep 3
  if zcode_running; then
    pkill -KILL -x "ZCode" >>"$LOG" 2>&1 || true
    sleep 1
  fi
fi
zcode_running && log "警告：ZCode 进程仍在，继续尝试启动"
sleep 1

# ---------- 第 2 步：带调试端口重启 ----------
log "第 2 步：带调试端口重启 ZCode……"
open -a "ZCode" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=${PORT}

# 等调试端口起来（最多 12 秒）
port_up=0
for i in $(seq 1 48); do
  if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    port_up=1
    break
  fi
  sleep 0.25
done

# open --args 没把端口带上的兜底：直接执行二进制
if [ "$port_up" != "1" ]; then
  log "open 方式没开出调试端口，改用直接启动……"
  osascript -e 'quit app "ZCode"' >>"$LOG" 2>&1 || true
  wait_zcode_exit || { pkill -TERM -x "ZCode" >>"$LOG" 2>&1 || true; sleep 3; }
  nohup "$APP_BIN" --remote-debugging-address=127.0.0.1 --remote-debugging-port=${PORT} >>"$LOG" 2>&1 &
  for i in $(seq 1 48); do
    if curl -sf "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
      port_up=1
      break
    fi
    sleep 0.25
  done
fi

if [ "$port_up" != "1" ]; then
  log "错误：调试端口始终没起来，无法注入。ZCode 本身可正常使用。"
  exit 1
fi
log "调试端口已就绪"

# ---------- 第 3 步：注入主题 ----------
log "第 3 步：等待主窗口并注入主题……"
if node "$DIR/apply.mjs" --port "$PORT" --theme "$THEME" --wait 60000 2>&1 | tee -a "$LOG"; then
  log "完成 🎉 皮肤已生效。日志：$LOG"
else
  log "注入失败：ZCode 可正常使用但没换肤，详见 $LOG"
  exit 1
fi
