# 更新日志（CHANGELOG）

## 1.1.0（2026-08-29）对齐 codex-skin-studio

新增：

- **面板上传图片建主题**：主题中心里「＋ 自定义图片」，选图自动取色/判深浅/校正主色，
  与终端 `create-theme.mjs` 同一套逻辑（`lib/autocolor.mjs`）
- **🎲 随机主题**：守护进程挑选时避开当前主题，避免连续重复
- **皮肤常驻开关**：面板底部「🔁 常驻」，关闭后本次会话继续用、下次启动恢复官方外观
  （对应 heige 的「皮肤常驻」）
- **阅读增强**：面板「📖 阅读」，给 AI 回复和思考块加 90% 主题自适应半透明底色 +
  对称留白（对应 heige 的「阅读增强」，默认关闭）
- **小圆点模式**：Cmd+点击 🎨 按钮或面板里「收起为小圆点」（对应 heige 的「隐藏按钮」）
- **「ZCode 皮肤.app」启动器**：`bash make-launcher.sh` 生成到 `~/Applications`，
  双击恢复上次皮肤/自检守护进程/端口丢失时给指引（对应 heige 的皮肤启动器）
- **AI Skill**：`skill/zcode-skin/SKILL.md`，可交给 ZCode/ZCode 类 Agent 直接操作本工具
- **主题提示词库**：`docs/theme-prompts.md`，8 套风格即复制即用
- SECURITY.md 安全说明

改进：

- create-theme.mjs 取色逻辑抽为共享模块 `lib/autocolor.mjs`（终端与面板同一实现）
- state.json 扩展为完整状态/设置存储（增量更新，防并发写坏）
- README.en.md 英文版

## 1.0.0（2026-08-28）首发

- CSS 变量覆盖式换肤（39 个语义变量，ZCode 升级不易失效）
- 22 套内置主题（8 渐变 + 14 背景图）
- `use-skin.sh` 终端菜单（编号/中文模糊/目录名/还原）
- `create-theme.mjs` 一张图片生成主题（canvas 取色 + HSL 主色可见度校正）
- ZCode 界面内 🎨 主题中心面板
- LaunchAgent 守护进程：皮肤保活（5 秒巡检自动补注入）+ 端口丢失系统通知
- `apply-skin.sh` launchd 一次性重启器（退出→带端口重启→注入→保底拉起）
