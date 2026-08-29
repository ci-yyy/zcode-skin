#!/bin/bash
# uninstall-daemon.sh — 卸载皮肤守护进程（LaunchAgent）
# 只停守护进程；ZCode 里已注入的皮肤和 🎨 按钮不受影响（但按钮的列表会加载失败，
# 可用 node apply.mjs --remove-panel 移除按钮）。

set -u
LABEL="dev.zcode.skin.daemon"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "✅ 皮肤守护进程已卸载"
else
  echo "ℹ️ 没有安装过守护进程"
fi
