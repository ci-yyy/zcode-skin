#!/bin/bash
# make-launcher.sh — 在 ~/Applications 生成「ZCode 皮肤.app」启动器
#
# 启动器做什么（macOS 原生 AppleScript app，双击即用）：
#   · 恢复皮肤：ZCode 在跑但皮肤丢了 → 按上次主题重新注入（不重启 ZCode）
#   · 没带端口：ZCode 在跑但调试端口没开 → 提示跑 apply-skin.sh（不会擅自重启）
#   · ZCode 没在跑 → 提示（不擅自启动）
#   · 顺带自检守护进程没在跑就把它拉起来（LaunchAgent 方式）
#
# 用法：bash make-launcher.sh    （重复执行 = 覆盖升级）

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Applications/ZCode 皮肤.app"

# node 绝对路径探测（AppleScript 里没有 PATH）
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

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# 把引号和反斜杠安全地嵌进 AppleScript 字符串
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
ESC_DIR="$(esc "$DIR")"
ESC_NODE="$(esc "$NODE_BIN")"

# AppleScript 主逻辑编译为 applet 放 Resources；MacOS 下的 bash 包装负责唤起
# （osacompile 的可执行体直接放 MacOS 会因 bundle 结构不标准而打不开）
cat > "$APP_DIR/Contents/Resources/main.scpt" <<EOF
on run
  set toolDir to "$ESC_DIR"
  set nodeBin to "$ESC_NODE"

  -- 守护进程没在跑就拉起（LaunchAgent，幂等）
  do shell script "launchctl list | grep -q dev.zcode.skin.daemon || launchctl load ~/Library/LaunchAgents/dev.zcode.skin.daemon.plist 2>/dev/null; curl -sf --max-time 2 http://127.0.0.1:9344/health >/dev/null 2>&1 || bash " & quoted form of (toolDir & "/install-daemon.sh") & " >/dev/null 2>&1 &"

  -- ZCode 进程在不在
  set zcodeRunning to do shell script "ps aux | grep -v grep | grep -q 'MacOS/ZCode' && echo yes || echo no"

  -- 调试端口在不在
  set portUp to do shell script "curl -sf --max-time 2 http://127.0.0.1:9343/json/version >/dev/null 2>&1 && echo yes || echo no"

  if zcodeRunning is "no" then
    display dialog "ZCode 现在没在运行。皮肤只在 ZCode 打开时生效，先打开 ZCode 再点我。" with title "ZCode 皮肤" buttons {"好"} default button "好" with icon note
    return
  end if

  if portUp is "no" then
    display dialog "ZCode 在运行，但调试端口没开（可能被普通方式重启过）。

需要恢复：在终端执行
bash " & toolDir & "/apply-skin.sh

（会自动完成：退出 ZCode → 带端口重启 → 注入上次主题；会话数据不丢）" with title "ZCode 皮肤" buttons {"知道了"} default button "知道了" with icon caution
    return
  end if

  -- 端口在：读上次主题并重新注入
  set themeJson to do shell script "cat " & quoted form of (toolDir & "/state.json") & " 2>/dev/null || echo '{\"theme\":null}'"
  set themeDir to do shell script nodeBin & " -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(s.theme||\"default\")' " & quoted form of themeJson
  if themeDir is "" then set themeDir to "default"

  set applyOut to do shell script nodeBin & " " & quoted form of (toolDir & "/apply.mjs") & " --port 9343 --theme " & quoted form of (toolDir & "/themes/" & themeDir) & " --wait 8000 2>&1 || true"
  display dialog "已按上次使用的主题恢复皮肤。" & return & return & applyOut with title "ZCode 皮肤" buttons {"好"} default button "好" with icon note
end run
EOF

osacompile -o "$APP_DIR/Contents/Resources/main.applet" "$APP_DIR/Contents/Resources/main.scpt"
rm -f "$APP_DIR/Contents/Resources/main.scpt"

cat > "$APP_DIR/Contents/MacOS/ZCodeSkinLauncher" <<EOF
#!/bin/bash
# 「ZCode 皮肤」启动器包装：跑编译好的 AppleScript applet
exec osascript "\$(dirname "\$0")/../Resources/main.applet/Contents/MacOS/applet" "\$@"
EOF
chmod +x "$APP_DIR/Contents/MacOS/ZCodeSkinLauncher"

cat > "$APP_DIR/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ZCode 皮肤</string>
  <key>CFBundleDisplayName</key><string>ZCode 皮肤</string>
  <key>CFBundleIdentifier</key><string>dev.zcode.skin.launcher</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>ZCodeSkinLauncher</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

echo "✅ 启动器已生成：$APP_DIR"
echo "   双击「ZCode 皮肤」：恢复上次皮肤 / 自检守护进程 / 没端口时给出恢复指引"
