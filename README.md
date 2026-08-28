# ZCode 换肤工具

给 ZCode 桌面客户端换皮肤。

工作方式：ZCode 以本机调试端口启动后，工具通过端口向界面注入一段主题 CSS，覆盖 ZCode
的界面颜色变量。**不修改 ZCode 应用本体**（不动安装目录、不改签名、不碰会话数据），
随时一键还原。

环境要求：macOS + Node.js 22 及以上（CDP 通信用 Node 自带的 WebSocket 和 fetch，无需安装任何依赖包）。

三个入口各管一件事：

| 入口 | 干什么 |
|---|---|
| `use-skin.sh` | 终端里切换主题 |
| ZCode 界面里的 🎨 主题中心 | 鼠标点选切换主题（需装守护进程） |
| `apply-skin.sh` | 首次启用 / ZCode 被普通方式重启后恢复 |

## 主题切换（日常用这个）

```bash
bash use-skin.sh
```

不带参数运行：列出全部 22 套主题（每套带编号、深浅图标、类型），输入编号或名字回车即可切换。

```bash
bash use-skin.sh 5          # 按编号切换（编号就是菜单里的序号）
bash use-skin.sh 佐助        # 按名字切换，支持中文模糊匹配
bash use-skin.sh origami     # 按主题目录名切换
bash use-skin.sh 还原        # 移除皮肤，恢复 ZCode 官方外观
```

- 切换**立即生效，不需要重启 ZCode**
- 名字匹配规则：先按目录名精确/包含匹配，再按主题显示名模糊匹配（忽略空格和中点，
  「原神·晨曦」「原神 晨曦」「原神晨曦」效果相同）
- 一个词匹配到多套主题时（如「原神」匹配晨曦+星夜两套），列出候选并切换第一套

## ZCode 界面里的「🎨 主题中心」

安装守护进程后（见下一节），ZCode 界面右下角会出现一个半透明的 🎨 圆形按钮：

- 点开就是主题列表（色卡预览 + 深浅图标 + 当前主题打勾），点一下立即换肤
- **＋ 自定义图片**：选一张图，自动取色/判深浅/校正主色，当场生成新主题并换上
  （与终端 `create-theme.mjs` 同一套逻辑）
- **🎲 随机主题**：随机换一套（避开当前主题，不连续重复）
- **🔁 常驻开关**：默认开。关掉后本次会话皮肤继续用，ZCode 下次启动恢复官方外观
- **📖 阅读增强开关**：默认关。开启后 AI 回复和思考过程块加 90% 主题自适应半透明底色，
  背景图主题下文字更容易读
- **● 收起为小圆点**：把 🎨 按钮收成小圆点（Cmd+点击按钮也能切换），小圆点悬停放大、点击照常打开
- 底部「还原官方外观」按钮一键去皮肤
- 终端 `use-skin.sh` 和面板两边切换会互相同步（谁最后操作听谁的）

按钮和面板在 ZCode 刷新或升级后消失的话，守护进程 5 秒内会自动补回来（「🔁 常驻」关闭时除外）。

## 「ZCode 皮肤.app」启动器（可选）

```bash
bash make-launcher.sh
```

在 `~/Applications` 生成「ZCode 皮肤.app`，双击即可：

- ZCode 在跑、皮肤丢了 → 按上次主题自动恢复（**不重启 ZCode**）
- 调试端口丢了（ZCode 被普通方式重启过）→ 弹窗指引恢复命令
- 顺带自检守护进程，没在跑会自动拉起

电脑重启、ZCode 升级或皮肤意外丢失后，双击这个 App 就行，不用记命令。

## 皮肤守护进程（LaunchAgent）

```bash
bash install-daemon.sh      # 安装（开机自启，立刻运行）
bash uninstall-daemon.sh    # 卸载
```

守护进程装好后做三件事：

1. **主题中心**：给 ZCode 界面注入 🎨 按钮和面板（丢了自动补），并提供面板用的
   主题列表/CSS/上传/随机/设置接口
2. **皮肤保活**：ZCode 刷新/升级导致皮肤丢失时，自动按上次用的主题重新注入（每 5 秒巡检一次；
   「🔁 常驻」开关关闭时停止注入，本次会话用完即止）
3. **恢复提醒**：ZCode 被普通方式（启动台/访达）重启后调试端口会消失，此时弹一条 macOS
   系统通知提醒你执行 `bash apply-skin.sh` 恢复。**守护进程自己绝不会重启 ZCode**。

守护进程的本地服务只监听 127.0.0.1:9344（主题列表/CSS 下发给面板用），日志在
`logs/daemon.log`。卸载守护进程后，已注入的皮肤和按钮还在，但按钮的列表会加载失败
（可用 `node apply.mjs --remove-panel` 把按钮移掉）。安全边界见 [SECURITY.md](SECURITY.md)。

## 首次启用

ZCode 默认启动时不带调试端口，换肤前需要让 ZCode 带端口（9343）启动一次：

```bash
bash apply-skin.sh
```

自动执行：退出 ZCode → 带调试端口重启 → 注入默认皮肤「极光蓝 · 玻璃」。
执行期间 ZCode 窗口会关闭再自动打开，会话数据不丢失。

重启动作由 macOS launchd 以系统任务执行，独立于 ZCode 进程（避免"退出了没人拉起来"），
且内置保底逻辑：无论中间哪步失败，最后都会确保 ZCode 处于运行状态。

> ⚠️ 工具目录不要放在「下载」「桌面」「文稿」这类受 macOS 隐私保护的文件夹里：
> launchd 无法执行这些位置的脚本（报 `Operation not permitted`），`apply-skin.sh` 会失败。
> 建议放在 `~/zcode-skin/` 等普通目录。日常切换主题（`use-skin.sh`）不受此影响，
> 只有涉及 launchd 的首次启用受影响。

之后如果 ZCode 被完全退出并用普通方式（启动台/访达）重新打开，端口消失、皮肤消失
（装了守护进程的话会收到系统通知），重新执行一次 `bash apply-skin.sh` 即可。

也可以手动带端口启动（效果等同）：

```bash
open -a ZCode --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9343
```

## 制作新主题

### 一张图片自动生成

```bash
node create-theme.mjs --image /path/to/图片.jpg --name "主题名"
bash use-skin.sh 主题名
```

自动完成：分析图片取色（统计色相得到主色和辅色、计算整体亮度）→ 按亮度自动判定
深色/浅色主题 → 主色过暗或过亮时自动校正到可读区间（保持色相）→ 图片设为整窗背景 →
生成完整主题目录进入主题库。缺背景图的话，[docs/theme-prompts.md](docs/theme-prompts.md)
里有 8 套风格现成的生图提示词。

参数：

| 参数 | 说明 |
|---|---|
| `--image` | 图片路径（png / jpg / webp），必填 |
| `--name` | 主题显示名，默认取图片文件名 |
| `--id` | 主题目录名（英文数字连字符），默认由 name 生成 |
| `--appearance` | `dark` / `light`，默认 `auto` 按图片亮度判定 |
| `--force` | 同名主题目录已存在时覆盖 |
| `--port` | CDP 端口，默认 9343 |

### 手工编写

在 `themes/` 下新建目录，放一个 `theme.json`：

```json
{
  "id": "my-theme",
  "name": "我的主题",
  "appearance": "dark",
  "heroImage": "hero.webp",
  "colors": {
    "sidebar": "#0a1526f0",
    "card": "#12233ae6",
    "foreground": "#dbe7ff",
    "brand": "#38bdf8"
  }
}
```

- `heroImage`：背景图文件名（与本目录内的图片对应），背景铺满整窗；不想要图片可用
  `heroCss` 写任意 CSS 背景（渐变等），两个都不写就是纯配色主题
- `colors`：全部可选，按需覆盖。支持 39 个键（对应 ZCode 界面的全部颜色变量，
  完整清单见 `lib/theme.mjs` 的 `VAR_MAP`），常用的：
  `background` `sidebar` `panel` `header` `card` `cardSelected` `border`
  `foreground`（正文）`foregroundSubtle`（次要文字）`foregroundSubtlest`（思考过程等最淡文字）
  `primary` `primaryForeground`（按钮及按钮文字）`brand`（品牌色）
  `hover` `selected` `input` `inputBorder` `popover` `menu` `terminalBg` `terminalFg`
- 颜色格式 `#RRGGBB` 或 `#RRGGBBAA`（末两位为透明度，`00` 全透明，`ff` 不透明）

生成前预览 CSS（不连接 ZCode）：

```bash
node apply.mjs --dry-run --theme themes/my-theme
```

新主题立即出现在 `use-skin.sh` 菜单和主题中心面板里，无需重启任何东西。

## 内置主题（22 套）

| # | 目录名 | 名称 | 深浅 | 类型 |
|---|---|---|---|---|
| 1 | cyber-neon | 赛博霓虹 | 🌙 | 渐变 |
| 2 | dalao-dianyan | 大佬 · 点烟 | 🌙 | 背景图 |
| 3 | deepspace-dawn | 恋与深空 · 晨曦 | ☀️ | 背景图 |
| 4 | deepspace-star | 恋与深空 · 星辰 | 🌙 | 背景图 |
| 5 | default | 极光蓝 · 玻璃 | 🌙 | 渐变 |
| 6 | dragonball-nimbus | 龙珠 · 筋斗云 | ☀️ | 背景图 |
| 7 | dragonball-super-saiyan | 龙珠 · 超级赛亚人 | ☀️ | 背景图 |
| 8 | forest-rain | 雨林墨绿 | 🌙 | 渐变 |
| 9 | genshin-dawn | 原神 · 晨曦 | ☀️ | 背景图 |
| 10 | genshin-night | 原神 · 星夜 | 🌙 | 背景图 |
| 11 | grape-soda | 葡萄气泡 | 🌙 | 渐变 |
| 12 | miku-488137 | Miku 488137 | ☀️ | 背景图 |
| 13 | mint-dawn | 薄荷晨雾 | ☀️ | 渐变 |
| 14 | mysterious-revival | 神秘复苏 | 🌙 | 背景图 |
| 15 | naruto-hokage | 火影 · 鸣人 | 🌙 | 背景图 |
| 16 | naruto-sasuke | 火影 · 佐助 | 🌙 | 背景图 |
| 17 | origami | 折纸 | 🌙 | 背景图 |
| 18 | paper-cream | 宣纸米白 | ☀️ | 渐变 |
| 19 | sakura-mist | 樱雾粉青 | 🌙 | 渐变 |
| 20 | sunset-gold | 落日熔金 | 🌙 | 渐变 |
| 21 | wuthering-echo | 鸣潮 · 共鸣 | 🌙 | 背景图 |
| 22 | wuthering-tide | 鸣潮 · 声骸 | 🌙 | 背景图 |

编号与 `bash use-skin.sh` 菜单序号一致（8 套渐变 + 14 套背景图）。动漫背景图版权归各自权利人，仅供个人使用。

## 命令速查

| 命令 | 作用 |
|---|---|
| `bash use-skin.sh` | 交互菜单：选编号或名字切换主题 |
| `bash use-skin.sh <编号/名字/还原>` | 直接切换 / 还原 |
| `bash install-daemon.sh` | 安装守护进程：🎨 主题中心 + 皮肤自动恢复 + 恢复提醒 |
| `bash uninstall-daemon.sh` | 卸载守护进程 |
| `bash make-launcher.sh` | 生成「ZCode 皮肤.app」启动器到 ~/Applications |
| `bash apply-skin.sh` | 首次启用：带调试端口重启 ZCode 并注入（ZCode 被普通重启后也用它恢复） |
| `node apply.mjs --list` | 列出全部主题 |
| `node apply.mjs --status` | 查询当前皮肤状态（是否生效、主题 ID、关键变量值、主题中心是否在位） |
| `node apply.mjs --theme themes/<名字>` | 注入指定主题（默认 default） |
| `node apply.mjs --panel` | 注入皮肤的同时注入主题中心按钮 |
| `node apply.mjs --remove-panel` | 只移除主题中心按钮（不动皮肤） |
| `node apply.mjs --dry-run --theme <目录>` | 只生成 CSS 不注入 |
| `node apply.mjs --port <端口>` | 指定 CDP 端口（默认 9343） |
| `node apply.mjs --wait <毫秒>` | 等待主窗口出现的最长时间（默认 15000） |
| `node create-theme.mjs --image <图> --name <名>` | 图片生成新主题 |
| `node restore.mjs` | 还原官方外观（效果同 `use-skin.sh 还原`） |

## 文件结构

```
zcode-skin/
├── use-skin.sh               # 日常入口（菜单实现在 lib/menu.mjs）
├── apply-skin.sh             # 首次启用入口（launchd 一次性重启+注入）
├── install-daemon.sh         # 安装皮肤守护进程（LaunchAgent）
├── uninstall-daemon.sh       # 卸载守护进程
├── daemon.mjs                # 守护进程：主题中心数据服务 + 皮肤保活 + 恢复提醒
├── apply.mjs                 # 注入器
├── create-theme.mjs          # 图片自动生成主题
├── restore.mjs               # 还原
├── relaunch-via-launchd.sh   # apply-skin.sh 调用的重启器（无需直接使用）
├── launch.sh                 # 旧版启动器（已被 apply-skin.sh 取代，保留备用）
├── make-launcher.sh          # 生成「ZCode 皮肤.app」启动器
├── state.json                # 当前主题与设置（终端/面板共用，已 gitignore）
├── lib/
│   ├── cdp.mjs               # CDP 客户端（零依赖，含主窗口识别）
│   ├── theme.mjs             # theme.json 校验 + 注入 CSS 生成（VAR_MAP 在这）
│   ├── palette.mjs           # 4 色→界面变量映射 + 主色可见度校正
│   ├── autocolor.mjs         # 图片取色→主题生成（终端与面板上传共用）
│   ├── inject.mjs            # 所有注入脚本片段（皮肤/面板/阅读增强/状态检查）
│   ├── panel.js              # 主题中心界面（注入 ZCode 内运行）
│   ├── state.mjs             # state.json 读写（主题 + 设置开关）
│   └── menu.mjs              # use-skin.sh 交互菜单
├── skill/zcode-skin/         # AI Skill（可交给 ZCode/Agent 直接操作本工具）
├── docs/theme-prompts.md     # 主题背景图生成提示词库（8 套风格）
├── themes/                   # 22 套主题，一目录一套
└── logs/                     # 运行日志（已 gitignore）
```

其他文档：[CHANGELOG.md](CHANGELOG.md) 更新日志 · [SECURITY.md](SECURITY.md) 安全边界 ·
[README.en.md](README.en.md) 英文版 · [docs/theme-prompts.md](docs/theme-prompts.md) 提示词库

## 注意事项

- 皮肤是运行时注入：装了守护进程时，ZCode 刷新/升级后皮肤和主题中心会自动补回；
  ZCode 被普通方式重启（端口消失）则皮肤随窗口消失，收到系统通知后执行 `apply-skin.sh` 恢复
- 两个本地端口都只绑定 127.0.0.1 本机回环，不对外网开放：9343 是 ZCode 的调试端口
  （换肤注入用），9344 是守护进程的主题数据服务（主题中心面板用）。同机其他进程也能
  连接它们，在意的话卸载守护进程并正常重启 ZCode
- ZCode 版本更新后若界面颜色变量改名，皮肤可能部分失效：`node apply.mjs --status`
  可查看注入是否还在生效

## 许可

MIT。
