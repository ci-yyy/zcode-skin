#!/bin/bash
# apply-skin.sh — 一键换肤入口（面向用户）
#
# 用法：双击本文件，或在终端执行  bash apply-skin.sh [主题目录]
#
# 原理：把重启+注入任务交给 macOS 的 launchd 执行。
# 脚本挂到 launchd 后就属于系统，独立于 ZCode 存活——ZCode 退出也不会带走它，
# 因此能可靠地完成「退出 → 带调试端口重启 → 注入皮肤」全流程，失败也会保底拉起 ZCode。
#
# 完成检测：等 relaunch-via-launchd.sh 写结果标记文件（launchctl list 里已完成
# 的一次性任务条目会一直挂着，用它判断会白等满超时）。无论脚本怎么退出（含
# Ctrl+C），EXIT trap 都会注销任务并删掉临时 plist，不留注册残留。

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.zcode.skin.relaunch"
GUI_DOMAIN="gui/$(id -u)"
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

cleanup() {
  launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
  rm -f "$PLIST"
}
trap cleanup EXIT

# 上次异常退出可能留下的注册和文件，先清干净
launchctl bootout "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST" "$RESULT_FILE"

# 把重启器注册成一次性 launchd 任务并立即启动
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
    <key>ZCODE_SKIN_RESULT_FILE</key><string>${RESULT_FILE}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${DIR}/logs/launchd-out.log</string>
  <key>StandardErrorPath</key><string>${DIR}/logs/launchd-err.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "$GUI_DOMAIN" "$PLIST"

# 等结果标记文件出现（relaunch 脚本结束时写），最多 3 分钟
elapsed=0
while [ $elapsed -lt 180 ]; do
  sleep 2; elapsed=$((elapsed + 2))
  if [ -f "$RESULT_FILE" ]; then
    break
  fi
  printf "\r已等待 %d 秒…" "$elapsed"
done
printf "\n"

echo ""
echo "──────────────────────────────────────"
if [ ! -f "$RESULT_FILE" ]; then
  echo "⏳ 超过 3 分钟还没跑完，请看日志：$LOG"
else
  if [ "$(cat "$RESULT_FILE" 2>/dev/null)" = "0" ]; then
    echo "✅ 完成：皮肤已注入"
  else
    echo "⚠️ 注入未成功（ZCode 本身可正常使用），看下面日志末尾"
  fi
  tail -8 "$LOG" 2>/dev/null
fi
echo ""
echo "完整日志：$LOG"
