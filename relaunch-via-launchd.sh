#!/bin/bash
# relaunch-via-launchd.sh — 由 launchd（系统服务）执行的一次性重启器
#
# 为什么用它：如果这个脚本由 ZCode 内的会话启动，ZCode 退出时会把脚本一起杀掉，
# 没人负责把 ZCode 拉回来（就是之前反复失败的原因）。
# 挂到 launchd 后，脚本属于 macOS，独立于 ZCode 存活，能完整跑完全部三步。
#
# 三步：退出 ZCode → 带调试端口 9343 重启 → 注入主题
# 保底：无论注入成功与否，最后都会确认 ZCode 已在运行；失败也会把 ZCode 拉起来。

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-9343}"
THEME="${THEME:-$DIR/themes/default}"
LOG_DIR="$DIR/logs"
LOG="$LOG_DIR/relaunch.log"
mkdir -p "$LOG_DIR"

exec >>"$LOG" 2>&1

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$1"; }

# launchd 环境的 PATH 很精简（/usr/bin:/bin:...），nvm/homebrew 装的 node 不在里面，
# 注入步骤需要 node，这里按常见位置探测出绝对路径
NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "$HOME/.nvm/versions/node/v24.16.0/bin/node" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done
[ -n "$NODE_BIN" ] && log "使用 node：$NODE_BIN" || log "警告：找不到 node，注入步骤会失败"

# 主进程探测：ps comm 精确匹配。不能用 `ps aux | grep "MacOS/ZCode"`：
# 主进程 args 只显示 "ZCode" 匹配不上，反而 Computer Use broker 的路径
# （MacOS/ZCode Computer Use）会误匹配，导致退出等待空转、保底误判。
zcode_running() {
  ps -eo comm= | grep -qx "ZCode"
}

wait_exit() {
  local i
  for i in $(seq 1 60); do
    zcode_running || return 0
    sleep 0.25
  done
  return 1
}

ensure_zcode_up() {
  # 保底：无论之前发生什么，确保 ZCode 最终在运行
  local i
  for i in $(seq 1 20); do
    zcode_running && return 0
    sleep 0.5
  done
  log "保底触发：ZCode 没在运行，用普通方式拉起……"
  open -a "ZCode"
  for i in $(seq 1 30); do
    zcode_running && { log "保底成功：ZCode 已恢复运行"; return 0; }
    sleep 0.5
  done
  log "保底失败：open -a 也没拉起 ZCode，请手动打开 ZCode"
  return 1
}

log "==== relaunch-via-launchd 开始 | 端口 ${PORT} | 主题 ${THEME} ===="

# ---------- 第 1 步：退出 ----------
log "第 1 步：退出 ZCode……"
osascript -e 'quit app "ZCode"' || true
if ! wait_exit; then
  log "温和退出超时，发 TERM……"
  pkill -TERM -x ZCode || true
  sleep 3
fi
if zcode_running; then
  log "仍在运行，发 KILL（最后手段）……"
  pkill -KILL -x ZCode || true
  sleep 2
fi
zcode_running && log "警告：ZCode 进程仍存在，继续下一步"

# ---------- 第 2 步：带端口重启 ----------
log "第 2 步：带调试端口重启 ZCode……"
open -a "ZCode" --args --remote-debugging-address=127.0.0.1 --remote-debugging-port="${PORT}"

port_up=0
for i in $(seq 1 60); do
  if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
    port_up=1
    break
  fi
  sleep 0.5
done

if [ "${port_up}" != "1" ]; then
  log "open 没开出端口，改直接执行二进制……"
  osascript -e 'quit app "ZCode"' || true
  wait_exit || { pkill -TERM -x ZCode || true; sleep 3; }
  nohup /Applications/ZCode.app/Contents/MacOS/ZCode \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port="${PORT}" \
    >>"$LOG" 2>&1 &
  for i in $(seq 1 60); do
    if curl -sf --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
      port_up=1
      break
    fi
    sleep 0.5
  done
fi

# ---------- 第 3 步：注入 ----------
inject_result=1
if [ "${port_up}" = "1" ] && [ -n "$NODE_BIN" ]; then
  log "调试端口就绪，注入主题……"
  if "$NODE_BIN" "$DIR/apply.mjs" --port "${PORT}" --theme "${THEME}" --wait 60000; then
    log "注入成功 🎉"
    inject_result=0
  else
    log "注入失败（ZCode 仍在正常运行，只是没换肤）"
  fi
elif [ "${port_up}" = "1" ]; then
  log "端口就绪但没找到 node，无法注入"
else
  log "调试端口始终没起来，跳过注入"
fi

# ---------- 保底 ----------
ensure_zcode_up
log "==== 结束 | 注入结果: $([ $inject_result -eq 0 ] && echo 成功 || echo 失败) ===="
# 结果标记：apply-skin.sh 靠它判断任务结束（launchctl list 里条目跑完也挂着，不可靠）
printf '%s\n' "$inject_result" > "${ZCODE_SKIN_RESULT_FILE:-/tmp/zcode-skin-last-run.result}"
exit $inject_result
