#!/bin/bash
# uninstall.sh — 彻底卸载 zcode-skin 的所有痕迹
#
# 清理范围（按执行顺序）：
#   1. ZCode 页面里注入的皮肤 <style> 和 🎨 主题中心按钮（走 CDP，不重启 ZCode）
#   2. launchd 一次性任务 com.zcode.skin.relaunch（apply-skin.sh 的临时注册）
#   3. 皮肤守护进程 dev.zcode.skin.daemon（LaunchAgent + 进程）
#   4. 「ZCode 皮肤.app」启动器（~/Applications）
#   5. /tmp 临时文件（结果标记、自测文件、relaunch plist）
#   6. 工具目录本身（默认询问；--yes 跳过；--keep-dir 只清外部痕迹不删目录）
#
# 用法：bash uninstall.sh [--yes] [--keep-dir]
#   --yes       所有确认自动回答是（脚本放别处跑也建议用：日志路径取不到时不卡询问）
#   --keep-dir  不删除工具目录（比如只是想把外部痕迹清干净重新装）
#
# 幂等：重复运行安全，没有的东西直接跳过。
# 注意：先跑本目录里的 uninstall.sh（需要这里的 node 脚本做 CDP 还原），
#       目录删掉之后就只能手动还原 ZCode（重启 ZCode 即回官方外观）。

set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
ASSUME_YES=0
KEEP_DIR=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --keep-dir) KEEP_DIR=1 ;;
    *) echo "未知参数：$arg（可用：--yes --keep-dir）"; exit 2 ;;
  esac
done

DAEMON_LABEL="dev.zcode.skin.daemon"
RELABEL_LABEL="com.zcode.skin.relaunch"
GUI_DOMAIN="gui/$(id -u)"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
APP_DIR="$HOME/Applications/ZCode 皮肤.app"

# 统计式输出：每一步都报告做了什么/没什么可做，失败不中断（卸载要尽量往前走）
done_count=0
note() { echo "  $1"; }
ok()   { echo "✅ $1"; done_count=$((done_count + 1)); }
skip() { echo "ℹ️  $1"; }

confirm() { # confirm "问题" → 0=是
  [ "$ASSUME_YES" = "1" ] && return 0
  local answer
  printf "%s [y/N] " "$1"
  read -r answer
  [[ "$answer" =~ ^[Yy] ]]
}

echo "ZCode Skin 彻底卸载"
echo "工具目录：$DIR"
echo ""

# ---------- 1) 还原 ZCode 页面（移除注入的皮肤和面板按钮） ----------
echo "── 1/6 还原 ZCode 页面"
if command -v node >/dev/null 2>&1; then
  if node "$DIR/restore.mjs" 2>/dev/null; then
    ok "皮肤与主题中心按钮已从 ZCode 页面移除"
  else
    skip "页面还原未执行（ZCode 没开或调试端口没开）。重启 ZCode 后同样恢复官方外观"
  fi
else
  skip "找不到 node，跳过页面还原。重启 ZCode 后同样恢复官方外观"
fi
echo ""

# ---------- 2) 一次性重启任务（apply-skin.sh 注册的） ----------
echo "── 2/6 清理一次性重启任务（com.zcode.skin.relaunch）"
if launchctl print "$GUI_DOMAIN/$RELABEL_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$GUI_DOMAIN/$RELABEL_LABEL" >/dev/null 2>&1 || true
  ok "已注销 $RELABEL_LABEL"
else
  skip "没有注册在案的重启任务"
fi
rm -f "/tmp/${RELABEL_LABEL}.plist" "/private/tmp/${RELABEL_LABEL}.plist"
rm -f /tmp/zcode-skin-last-run.result
note "临时 plist 与结果标记已清理"
echo ""

# ---------- 3) 守护进程（LaunchAgent） ----------
echo "── 3/6 卸载皮肤守护进程（dev.zcode.skin.daemon）"
if launchctl print "$GUI_DOMAIN/$DAEMON_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$GUI_DOMAIN/$DAEMON_LABEL" >/dev/null 2>&1 || true
  ok "已注销守护进程（进程随之终止）"
else
  skip "守护进程没有在运行"
fi
if [ -f "$LAUNCH_AGENTS/${DAEMON_LABEL}.plist" ]; then
  rm -f "$LAUNCH_AGENTS/${DAEMON_LABEL}.plist"
  ok "已删除 ${LAUNCH_AGENTS}/${DAEMON_LABEL}.plist"
else
  skip "LaunchAgents 里没有守护进程 plist"
fi
# 9344 端口没人监听才算干净（bootout 异步生效，稍等）
for _ in $(seq 1 10); do
  curl -sf --max-time 1 http://127.0.0.1:9344/health >/dev/null 2>&1 || break
  sleep 0.5
done
if curl -sf --max-time 1 http://127.0.0.1:9344/health >/dev/null 2>&1; then
  # 兜底：还有残留进程占着端口，按命令行特征杀掉
  pkill -f "daemon.mjs" 2>/dev/null && ok "已终止残留的 daemon.mjs 进程" || true
fi
echo ""

# ---------- 4) 启动器 App ----------
echo "── 4/6 删除「ZCode 皮肤.app」启动器"
if [ -d "$APP_DIR" ]; then
  rm -rf "$APP_DIR"
  ok "已删除 $APP_DIR"
else
  skip "没有生成过启动器"
fi
echo ""

# ---------- 5) /tmp 杂项 ----------
echo "── 5/6 清理 /tmp 杂项"
removed_tmp=0
for f in /tmp/zcsk-launcher-selftest.txt; do
  if [ -f "$f" ]; then rm -f "$f"; removed_tmp=1; fi
done
[ "$removed_tmp" = "1" ] && ok "已删除启动器自测临时文件" || skip "没有临时文件"
echo ""

# ---------- 6) 工具目录 ----------
echo "── 6/6 删除工具目录"
if [ "$KEEP_DIR" = "1" ]; then
  skip "按 --keep-dir 保留工具目录：$DIR"
elif [ "$DIR" = "$HOME" ] || [ "$DIR" = "/" ] || [ "${#DIR}" -lt 8 ]; then
  # 防御：目录路径看着不对劲就不删（避免脚本被拷到奇怪位置后误删）
  skip "目录路径可疑（$DIR），跳过自删。确认后手动执行：rm -rf \"$DIR\""
else
  if confirm "删除工具目录 $DIR？（包含全部主题与自定义主题，不可恢复）"; then
    # 自删：先确认这个目录确实是 zcode-skin（有 daemon.mjs + uninstall.sh 特征）
    if [ -f "$DIR/daemon.mjs" ] && [ -f "$DIR/uninstall.sh" ]; then
      echo "  正在删除……"
      rm -rf "$DIR" && ok "已删除 $DIR" || echo "❌ 删除失败，请手动执行：rm -rf \"$DIR\""
    else
      skip "目录特征不符（没有 daemon.mjs/uninstall.sh），跳过自删。确认后手动执行：rm -rf \"$DIR\""
    fi
  else
    skip "保留工具目录：$DIR"
  fi
fi

echo ""
echo "卸载完成。ZCode 本身、会话数据、设置均未被改动。"
echo "如果刚才 ZCode 没在运行/没带端口，重启一次 ZCode 即完全恢复官方外观。"
