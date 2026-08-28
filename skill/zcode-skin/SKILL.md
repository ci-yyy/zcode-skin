---
name: zcode-skin
description: Use when 用户想给 ZCode 桌面客户端换皮肤、装主题、做主题、恢复官方外观，或设置皮肤常驻/阅读增强等选项。
---

# ZCode Skin（ZCode 桌面客户端换肤）

工具位置以用户实际安装为准，默认 `~/zcode-skin/`。下文用 `$SKIN` 指代该目录。
原理：ZCode 带 `--remote-debugging-port=9343` 启动后，通过 CDP 往界面注入主题 CSS（只覆盖 CSS 变量），
不修改 app.asar、签名或会话数据。

## 必须遵守

1. **绝不擅自重启 ZCode**。唯一允许的重启入口是用户明确同意后执行 `$SKIN/apply-skin.sh`（它自带"退出→带端口重启→注入→保底拉起"的完整链路）。
2. 日常切换主题**不需要重启**：`bash $SKIN/use-skin.sh 主题名` 立即生效。
3. 判断状态用只读命令：`node $SKIN/apply.mjs --status`，不要用重启代替状态检查。
4. 失败后不做无界重试；保留原始错误再决定下一步。
5. 工具目录不能位于「下载/桌面/文稿」（macOS TCC 保护，launchd 无法执行其中的脚本）。

## 常用操作

| 意图 | 命令 |
|---|---|
| 列出主题 | `node $SKIN/apply.mjs --list` |
| 切换主题（立即生效） | `bash $SKIN/use-skin.sh <编号/名字/目录名>` |
| 还原官方外观 | `bash $SKIN/use-skin.sh 还原` |
| 查状态 | `node $SKIN/apply.mjs --status` |
| 首次启用 / 端口丢失后恢复 | `bash $SKIN/apply-skin.sh`（会重启 ZCode，先征得用户同意） |
| 装守护进程（主题中心/保活/通知） | `bash $SKIN/install-daemon.sh` |
| 卸载守护进程 | `bash $SKIN/uninstall-daemon.sh` |
| 生成「ZCode 皮肤.app」启动器 | `bash $SKIN/make-launcher.sh` |
| 一张图做主题 | `node $SKIN/create-theme.mjs --image <图> --name "名字"` |

## 语义

- **皮肤常驻**（默认开）：ZCode 刷新/升级后守护进程自动恢复皮肤和 🎨 主题中心。关掉后本次会话继续用，下次启动恢复官方外观。开关在 ZCode 界面的 🎨 主题中心里。
- **阅读增强**（默认关）：给 AI 回复/思考块加半透明底色，背景图主题下更易读。开关同样在主题中心。
- **面板上传主题**：主题中心里「＋ 自定义图片」，走与 create-theme.mjs 相同的取色/校正逻辑。
- **随机主题**：主题中心「🎲 随机主题」，守护进程避免连续重复。
- **小圆点模式**：Cmd+点击 🎨 按钮或面板里「收起为小圆点」。

## 典型故障

| 症状 | 处理 |
|---|---|
| `use-skin.sh` 报"调试端口没开" | ZCode 被普通方式重启过。征得同意后跑 `apply-skin.sh` |
| 皮肤突然消失又自动回来 | 正常：ZCode 刷新页面，守护进程 5 秒内自动补上 |
| 收到"ZCode 皮肤"系统通知 | 提示端口丢失，按通知里的命令恢复 |
| 主题部分颜色没变 | ZCode 升级改了 CSS 变量名。用 `--status` 核对，再对照 `lib/theme.mjs` 的 VAR_MAP |
