#!/bin/bash
# install-daemon.sh — 安装皮肤守护进程（LaunchAgent）
# 作用：开机自动启动 daemon.mjs，实现
#   · ZCode 界面里的「🎨 主题中心」面板可用
#   · ZCode 刷新/升级后皮肤自动补上
#   · ZCode 被普通方式重启（端口丢失）时弹系统通知提醒恢复
# 卸载：bash uninstall-daemon.sh

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="dev.zcode.skin.daemon"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$DIR/logs"
mkdir -p "$LOG_DIR"

# launchd 环境 PATH 很精简，node 用绝对路径写进 plist
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$c" ]; then NODE_BIN="$c"; break; fi
  done
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "❌ 找不到 node，先装 Node.js 22+ 再运行"
  exit 1
fi

# 工具目录不能在 Downloads/Desktop/Documents（launchd 无法执行，macOS 隐私保护）
case "$DIR" in
  */Downloads/*|*/Desktop/*|*/Documents/*)
    echo "❌ 工具目录在受 macOS 保护的文件夹里（$DIR），launchd 无法执行这里的脚本。"
    echo "   请把整个目录移到比如 ~/zcode-skin 再安装。"
    exit 1
    ;;
esac

# KeepAlive 用字典形式：只在非正常退出（崩溃/被杀）时重启。
# 纯 true 的话 exit(0) 也会被拉起——9344 端口被占时守护进程安静退出后
# 会被 launchd 每 10 秒无限重拉。SuccessfulExit=false 后干净退出不重启，
# SIGTERM（卸载/重装）走 exit(0) 也不会复活。

# 重复安装时先卸旧的（bootout 对已注销的 label 会报错，忽略即可）
if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${DIR}/daemon.mjs</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${LOG_DIR}/launchd-out.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/launchd-err.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST" || launchctl load "$PLIST"

# 健康检查带重试：launchd 拉起 + node 启动要一小会儿，单次 curl 容易误报
healthy=0
for _ in $(seq 1 10); do
  if curl -sf --max-time 2 http://127.0.0.1:9344/health >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 1
done

if [ "$healthy" = "1" ]; then
  echo "✅ 皮肤守护进程已安装并运行"
  echo "   · ZCode 界面右下角的 🎨 主题中心按钮已可用（最多等 5 秒自动出现）"
  echo "   · ZCode 刷新/升级后皮肤会自动补上"
  echo "   · 卸载：bash ${DIR}/uninstall-daemon.sh"
else
  echo "⚠️ 已注册但健康检查没过，看日志：${LOG_DIR}/launchd-err.log"
  exit 1
fi
