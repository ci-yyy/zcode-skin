#!/bin/bash
# use-skin.sh — 日常换肤入口
# 实际交互逻辑在 lib/menu.mjs（用 Node 跑，避开 macOS 自带 bash 3.2 的
# mapfile 缺失和「变量后紧跟中文导致的解析 bug」）。
#
# 用法：
#   bash use-skin.sh              列出主题，按编号/名字选择
#   bash use-skin.sh 原神         按名字直接切换（支持模糊匹配）
#   bash use-skin.sh 还原         恢复官方外观
#
# 切换主题不需要重启 ZCode，立即生效。

DIR="$(cd "$(dirname "$0")" && pwd)"

NODE_BIN="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$c" ]; then
      NODE_BIN="$c"
      break
    fi
  done
fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "❌ 找不到 node（node 装在别处的话，编辑本文件把路径加进去）"
  exit 1
fi

exec "$NODE_BIN" "$DIR/lib/menu.mjs" "$@"
