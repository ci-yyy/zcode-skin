#!/bin/bash
# make-launcher.sh — 在 ~/Applications 生成「ZCode 皮肤.app」启动器
#
# app 结构：Contents/MacOS/ZCodeSkinLauncher 是 3 行 bash 包装，指向本目录的
# launcher-app.sh（逻辑住在仓库里，改逻辑不用重新生成）。
# LSUIElement=true：双击不占 Dock、不闪菜单栏，跑完静默退出
# （成功走系统通知，需要用户行动的指引才弹窗）。
#
# 用法：bash make-launcher.sh    （重复执行 = 覆盖升级）
# 生成后自动做结构与语法自检，并试跑一遍 launcher-app.sh（自测模式，不打扰屏幕）。

set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$HOME/Applications/ZCode 皮肤.app"
EXE="$APP_DIR/Contents/MacOS/ZCodeSkinLauncher"
SELFTEST_FILE="/tmp/zcsk-launcher-selftest.txt"

if [ ! -f "$DIR/launcher-app.sh" ]; then
  echo "❌ 找不到 ${DIR}/launcher-app.sh（启动器逻辑文件），请在完整的项目目录里运行"
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"

# 包装脚本只需要嵌入工具目录绝对路径（esc 处理反斜杠和双引号）
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
ESC_DIR="$(esc "$DIR")"

cat > "$EXE" <<EOF
#!/bin/bash
# 「ZCode 皮肤」启动器包装：实际逻辑在工具目录的 launcher-app.sh 里
exec /bin/bash "${ESC_DIR}/launcher-app.sh" "\$@"
EOF
chmod +x "$EXE"

cat > "$APP_DIR/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ZCode 皮肤</string>
  <key>CFBundleDisplayName</key><string>ZCode 皮肤</string>
  <key>CFBundleIdentifier</key><string>dev.zcode.skin.launcher</string>
  <key>CFBundleVersion</key><string>1.2.3</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>ZCodeSkinLauncher</string>
  <key>CFBundleShortVersionString</key><string>1.2.3</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

# bundle 能不能跑在这里拦住，不再等用户双击了才发现
bash -n "$DIR/launcher-app.sh" || { echo "❌ launcher-app.sh 语法错误"; exit 1; }
bash -n "$EXE" || { echo "❌ 生成的包装脚本语法错误"; exit 1; }
[ -x "$EXE" ] || { echo "❌ 包装脚本没有可执行位"; exit 1; }
plutil -lint "$APP_DIR/Contents/Info.plist" >/dev/null || { echo "❌ Info.plist 不合法"; exit 1; }

echo "✅ 启动器已生成：$APP_DIR"
echo "   双击「ZCode 皮肤」：恢复上次皮肤 / 自检守护进程 / 没端口时给出恢复指引"

# 试跑一遍：通知/弹窗写文件；对运行中的 ZCode 幂等重注入当前主题，无副作用
: > "$SELFTEST_FILE"
if ZCSK_LAUNCHER_SELFTEST=1 ZCSK_LAUNCHER_SELFTEST_FILE="$SELFTEST_FILE" bash "$EXE"; then
  echo "✅ 自测通过：$(tail -n 1 "$SELFTEST_FILE")"
else
  code=$?
  echo "ℹ️ 自测退出码 ${code}（1=ZCode 没开 2=端口没开 3=守护进程不健康 4=恢复失败），详情："
  sed 's/^/   /' "$SELFTEST_FILE"
fi
