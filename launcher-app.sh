#!/bin/bash
# launcher-app.sh — 「ZCode 皮肤.app」双击后真正执行的逻辑
# （make-launcher.sh 生成的 app 只是指向这里的薄包装，升级逻辑改本文件即可）
#
# 做什么：
#   · 自检守护进程：没在跑就跑 install-daemon.sh，等健康检查通过（最多约 15 秒）
#   · ZCode 在跑 + 调试端口在 → 按上次主题重新注入（不重启 ZCode），系统通知结果
#   · 上次是官方外观（theme=null）→ 不注入
#   · ZCode 没在跑 / 端口没开 → 弹窗给恢复指引（绝不擅自启动或重启 ZCode）
#
# 退出码：0 成功（或无需动作） 1 ZCode 没在运行 2 调试端口没开 3 守护进程不健康 4 恢复失败
# 自测模式：ZCSK_LAUNCHER_SELFTEST=1 时通知/弹窗全部改为写
# ZCSK_LAUNCHER_SELFTEST_FILE（默认 /tmp/zcsk-launcher-selftest.txt），不打扰屏幕

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
SELFTEST="${ZCSK_LAUNCHER_SELFTEST:-0}"
SELFTEST_FILE="${ZCSK_LAUNCHER_SELFTEST_FILE:-/tmp/zcsk-launcher-selftest.txt}"
CDP_PORT=9343
API_PORT=9344

# Finder 双击的 app 没有 PATH（nvm/homebrew 都不在），按常见位置探测 node 绝对路径
NODE_BIN=""
for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  "$HOME"/.nvm/versions/node/*/bin/node \
  /opt/homebrew/bin/node \
  /usr/local/bin/node; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

# AppleScript 字符串转义：反斜杠和双引号；换行压成空格（消息全部单行）
esc_msg() {
  printf '%s' "$1" | tr '\n' ' ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

note() { # 成功类信息 → 系统通知（不阻塞）
  if [ "$SELFTEST" = "1" ]; then
    printf '[%s] NOTE %s\n' "$(date '+%H:%M:%S')" "$1" >>"$SELFTEST_FILE"
    return 0
  fi
  local safe; safe="$(esc_msg "$1")"
  osascript -e "display notification \"${safe}\" with title \"ZCode 皮肤\"" >/dev/null 2>&1 || true
}

guide() { # 指引类信息 → 弹窗（需要用户行动）
  local icon="${2:-caution}" safe
  if [ "$SELFTEST" = "1" ]; then
    printf '[%s] GUIDE %s\n' "$(date '+%H:%M:%S')" "$1" >>"$SELFTEST_FILE"
    return 0
  fi
  safe="$(esc_msg "$1")"
  osascript -e "display dialog \"${safe}\" with title \"ZCode 皮肤\" buttons {\"好\"} default button \"好\" with icon ${icon}" >/dev/null 2>&1 || true
}

api_ok() { curl -sf --max-time 2 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; }
cdp_ok() { curl -sf --max-time 2 "http://127.0.0.1:${CDP_PORT}/json/version" >/dev/null 2>&1; }

# 主进程探测：ps comm 精确匹配（本机实测 pgrep -x ZCode 匹配不到主进程，
# 只能列出 Helper，launchd 的 PATH 精简环境下 ps 一样可用）
zcode_running() { ps -eo comm= | grep -qx "ZCode"; }

# ---------- 1) 守护进程 ----------
if ! api_ok; then
  bash "$DIR/install-daemon.sh" >/dev/null 2>&1
  for _ in $(seq 1 15); do
    api_ok && break
    sleep 1
  done
fi
if ! api_ok; then
  guide "皮肤守护进程没起来。看日志 ${DIR}/logs/launchd-err.log" caution
  exit 3
fi

# ---------- 2) ZCode 进程 ----------
if ! zcode_running; then
  guide "ZCode 现在没在运行。皮肤只在 ZCode 打开时生效，先打开 ZCode 再点我。" note
  exit 1
fi

# ---------- 3) 调试端口 ----------
if ! cdp_ok; then
  guide "ZCode 在运行但调试端口没开（可能被普通方式重启过）。恢复命令：bash ${DIR}/apply-skin.sh" caution
  exit 2
fi

if [ -z "$NODE_BIN" ]; then
  guide "找不到 node（需要 Node.js 22+），装好后重试。" caution
  exit 4
fi

# ---------- 4) 上次主题 ----------
theme_dir=""
if [ -f "$DIR/state.json" ]; then
  theme_dir="$("$NODE_BIN" -e 'let t="";try{t=String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).theme??"")}catch{}process.stdout.write(t)' "$DIR/state.json" 2>/dev/null || true)"
fi
if [ -z "$theme_dir" ]; then
  note "上次是官方外观，无需恢复。想换主题点 ZCode 右下角的 🎨。"
  exit 0
fi
if [ ! -d "$DIR/themes/$theme_dir" ]; then
  guide "上次用的主题目录不存在（${theme_dir}）。在 ZCode 里点 🎨 或跑 use-skin.sh 重选。" caution
  exit 4
fi

# ---------- 5) 注入 ----------
apply_out=""
if apply_out="$("$NODE_BIN" "$DIR/apply.mjs" --port "$CDP_PORT" --theme "$DIR/themes/$theme_dir" --wait 8000 2>&1)"; then
  note "已按上次主题「${theme_dir}」恢复皮肤。"
  exit 0
fi
guide "恢复皮肤失败：$(printf '%s' "$apply_out" | tail -n 2)" caution
exit 4
