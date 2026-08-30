# 更新日志（CHANGELOG）

## 1.2.2（2026-08-30）一键彻底卸载

- **新增 `uninstall.sh`**：一条命令卸载全部痕迹，六步幂等清理——① CDP 移除 ZCode
  页面里注入的皮肤与 🎨 主题中心（不重启 ZCode）② 注销 apply-skin.sh 的一次性
  重启任务 ③ 卸载守护进程（LaunchAgent + 进程 + 端口核验）④ 删除「ZCode 皮肤.app」
  启动器 ⑤ 清 /tmp 临时文件 ⑥ 询问后删工具目录。`--yes` 跳过确认、`--keep-dir`
  只清外部痕迹保留目录；目录自删前校验特征文件（daemon.mjs + uninstall.sh），
  脚本被拷到别处不会误删；ZCode 本体、会话数据、设置均不触碰
- **新增版本口径一致性测试**（`test/version.test.mjs`，5 个用例）：README 中英文
  头条块、CHANGELOG 小节、启动器 bundle 版本、README 用例数任一与 package.json
  /实际不符即测试失败——杜绝发版时「CHANGELOG 更了 README 头条忘更」的反复遗漏

## 1.2.1（2026-08-29）启动器重写 + 残留治理

修复（P0）：

- **「ZCode 皮肤.app」双击闪退修复**：旧版 `make-launcher.sh` 生成的 applet
  bundle 结构不标准（osacompile 产物是单个编译脚本文件而非 bundle），包装脚本
  执行的 `main.applet/Contents/MacOS/applet` 路径不存在，双击即闪退。重写为
  标准结构：bash 包装作 CFBundleExecutable，逻辑全部移入仓库内 `launcher-app.sh`
  （升级逻辑不用重新生成 app）；`LSUIElement=true` 双击不占 Dock，成功走系统通知、
  需要行动的指引才弹窗；生成时自动做结构/语法自检 + 免打扰自测跑一遍
- **主进程探测失效**：本机实测 `pgrep -x "ZCode"` 匹配不到 ZCode 主进程（只能
  列出 Helper），launch.sh 的退出等待会空转、launcher 误报「ZCode 没在运行」。
  launch.sh、launcher-app.sh、relaunch-via-launchd.sh 统一改用
  `ps -eo comm= | grep -qx "ZCode"`（relaunch 原来的 `ps aux | grep
  "MacOS/ZCode"` 还会误匹配 Computer Use broker 的路径，导致退出等待空转、
  保底拉起误判）

残留治理（P1）：

- **apply-skin.sh 不再留 launchd 残留**：改用 `launchctl bootstrap/bootout`；完成
  检测从 `launchctl list | grep`（一次性任务条目跑完仍挂着，会白等满 180 秒）
  改为 relaunch 脚本写结果标记文件；EXIT trap 保证 Ctrl+C / 关终端也注销任务、
  删除 /tmp 临时 plist——这正是此前手动清理 `com.zcode.skin.relaunch` 残留的根因
- install/uninstall-daemon.sh 同步迁移到 bootstrap/bootout；安装后健康检查从
  单次 curl 改为最长 10 秒重试，launchd 拉起慢不再误报失败

安全加固（P1）：

- **注入目标白名单收紧**：`classifyTargets` 的主窗口判定必须 `file://` 协议 +
  `out/renderer/index.html` 路径双条件（防 http 网页构造撞名 URL 被注入）；
  `pickMainWindow` 回退分支只认 `file://` 页面，http(s) 页面绝不作为注入目标

结构（P2）：

- daemon.mjs 的 HTTP API（路由/Origin 校验/请求体读取，约 270 行）拆到
  `lib/http-api.mjs`，daemon.mjs 只保留装配与生命周期（568→310 行）；
  daemon.mjs 再导出 `createRequestHandler` 保持旧引用兼容

文档修正：

- SECURITY.md 的上传体积上限从 20MB 更正为 12MB（1.2.0 收紧时漏改）
- 1.2.0 段的测试套件用例数从 106 更正为 111（笔误）

测试：111 → 114 个用例全绿（新增注入目标白名单与畸形 url 回归）

## 1.2.0（2026-08-29）安全加固 + 测试套件

安全（P0）：

- **9344 API 加 Origin 校验**：只放行无 Origin 头的本机进程（curl/Node）和 `null`/`file://`
  来源（ZCode 注入面板），浏览器里网页的跨站请求一律 403；CORS 头不再回显通配 `*`。
  修复任何网页 JS 都能改主题/开关/上传图片的漏洞
- **注入体积上限 16MB**：背景图 base64 后拼进 CSS 再整体走 `Runtime.evaluate`，
  之前无上限（上传 20MB 图可达 27MB+ 字符串直塞 Node 内存与 CDP 通道）。超限返回 413
  并提示换小图；上传上限从 20MB 收紧到 12MB（面板与守护进程双侧同步）
- **端口占用不再崩溃循环**：9344 被占时（重复安装守护进程）安静退出而不是抛错被
  launchd KeepAlive 反复拉起；补 `unhandledRejection`/`uncaughtException` 日志兜底

健壮性（P1）：

- **state.json 并发写保护**：终端 `use-skin.sh`、面板、守护进程同时写时不再互相覆盖
  丢 patch（读改写挪进文件锁内）；临时文件名带 pid+随机串防多进程互踩；锁带陈旧回收
  （持有进程已死或锁龄超 10 秒自动清），不会因一次崩溃永久卡死
- **守护进程缓存 CDP 会话**：巡检从「每 5 秒新建 WebSocket 再关掉」改为复用长连接，
  连接死了自动重连；ZCode 退出时主动清缓存
- **日志轮转**：`daemon.log` 超 1MB 改名 `.1`（只留一份备份），日志目录不再无限增长
- **面板请求 5 秒超时**：守护进程挂起时面板不再永久锁死，超时显示提示后按钮恢复可用
- 错误处理细节：上传超限后不再对已销毁 socket 写响应；通知里的恢复命令改用真实路径
  推导；`READING_STYLE_ID` 从 inject.mjs 导入消除硬编码；`/css/` `/applied/` 的畸形
  百分号转义返回 400 而不是 500；目录名校验补拒反斜杠与控制字符
- `state.json` 加 `schemaVersion` 字段，为将来结构迁移留出口
- `apply.mjs` 不再把 `themes/` 之外的路径写进 state.json（守护进程恢复时找不到会反复报错）

增强（P2）：

- **上传图片自动降采样**：最长边超 2560 或原图超 2MB 时缩到 2560 存 JPEG（带透明度
  的保持 PNG），生成主题的 hero 从几 MB 降到几百 KB，注入不再顶体积上限
- **`node diag.mjs` 一站式体检**：守护进程/调试端口/主窗口/注入状态/state.json/主题目录
  逐项检查并给修复指引

测试：

- 新增 `node --test` 测试套件（零依赖，111 个用例）：theme 校验与 CSS 生成、palette
  映射与主色校正边界、state 并发与锁回收、CDP 分类与假 WebSocket 错误路径、API 路由
  （含 Origin 校验/目录穿越/体积上限）、菜单归一化匹配、autocolor 生成流程
- 新增 `package.json`（`npm test` 直达）；`daemon.mjs`/`lib/menu.mjs` 支持被 import
  不带副作用（handler 抽成可注入依赖的 `createRequestHandler`）

## 1.1.1（2026-08-29）全量代码审查修复

- 修复：主题中心面板 Cmd+点击收起按钮时同时打开面板（事件监听合并为一个，修饰键分支优先）
- 修复：面板上传图片换肤后未写入 state.json，ZCode 刷新后守护进程会把皮肤恢复成旧主题
- 修复：阅读增强只覆盖思考块，最终回复没有底色（选择器补上 `.group/assistant-row`）
- 修复：还原官方外观（theme=null）后守护进程不再补主题中心按钮，导致无法再从面板选主题
- 修复：关闭「常驻」或未选过主题时，端口丢失不再弹系统通知打扰
- 修复：图片生成主题的目录名改用内容哈希，同一张图重复上传幂等覆盖（不再产生随机后缀目录堆积）
- 加固：state.json 原子写入（临时文件+改名，防并发/中断写坏）；上传生成的目录名边界校验

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
