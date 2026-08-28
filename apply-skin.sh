#!/bin/bash
# apply-skin.sh — 一键换肤入口（面向用户）
#
# 用法：双击本文件，或在终端执行  bash apply-skin.sh [主题目录]
#
# 原理：把重启+注入任务交给 macOS 的 launchd 执行。
# 脚本挂到 launchd 后就属于系统，独立于 ZCode 存活——ZCode 退出也不会带走它，
# 因此能可靠地完成「退出 → 带调试端口重启 → 注入皮肤」全流程，失败也会保底拉起 ZCode。

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.zcode.skin.relaunch"
PLIST="/tmp/${LABEL}.plist"
RESULT_FILE="/tmp/zcode-skin-last-run.result"
THEME="${1:-$DIR/themes/default}"
LOG="$DIR/logs/relaunch.log"

if [ "${THEME:0:1}" != "/" ]; then THEME="$DIR/$THEME"; fi

echo "══════════════════════════════════════"
echo " ZCode 一键换肤"
echo "══════════════════════════════════════"
echo "主题：$THEME"
echo ""
echo "即将重启 ZCode（窗口会关一下再回来，会话数据不丢）。"
echo "本窗口 3 秒后开始……按 Ctrl+C 可取消"
sleep 3

mkdir -p "$DIR/logs"

# 把重启器注册成一次性 launchd 任务并立即启动
rm -f "$RESULT_FILE"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${DIR}/relaunch-via-launchd.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>THEME</key><string>${THEME}</string>
    <key>PORT</key><string>9343</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${DIR}/logs/launchd-out.log</string>
  <key>StandardErrorPath</key><string>${DIR}/logs/launchd-err.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST"

# 等任务跑完（最多 3 分钟），每 2 秒汇报一次
elapsed=0
while [ $elapsed -lt 180 ]; do
  sleep 2; elapsed=$((elapsed + 2))
  if ! launchctl list 2>/dev/null | grep -q "$LABEL"; then
    break  # 任务已结束
  fi
  printf "\r已等待 %d 秒…" "$elapsed"
done
printf "\n"

launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"

echo ""
echo "──────────────────────────────────────"
if [ $elapsed -ge 180 ]; then
  echo "⏳ 超过 3 分钟还没跑完，请看日志：$LOG"
else
  tail -8 "$LOG" 2>/dev/null
fi
echo ""
echo "完整日志：$LOG"
