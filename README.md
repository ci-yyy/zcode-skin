# ZCode 换肤工具

给 ZCode 桌面客户端换皮肤的轻量工具。原理：通过本机调试端口向 ZCode 界面注入主题 CSS，
**不修改 ZCode 应用本体**，随时一键还原。

内置 18 套主题：4 套原创渐变主题、12 套动漫背景图主题（原神、火影、龙珠、鸣潮、
初音未来、恋与深空等）、2 套由用户图片自动生成的主题。

## 日常使用（最常用）

```bash
cd /path/to/zcode-skin

# 列出全部主题（带编号），交互选择
bash use-skin.sh

# 直接按名字切换（支持中文名模糊匹配，无需重启 ZCode，立即生效）
bash use-skin.sh 原神
bash use-skin.sh 火影
bash use-skin.sh miku-488137

# 还原官方外观
bash use-skin.sh 还原
```

**切换主题不需要重启 ZCode。** 只有第一次启用（或 ZCode 被普通方式重启后）才需要走下面的一次性流程。

## 第一次启用 / ZCode 重启后恢复

ZCode 平时启动不带调试端口，换肤需要它带端口启动。执行：

```bash
bash apply-skin.sh        # 自动：退出 ZCode → 带端口(9343)重启 → 注入默认皮肤
```

会关一次 ZCode 窗口再自动回来（会话数据不丢）。

也可以只在需要时手动带端口启动 ZCode（完全退出 ZCode 后，终端执行）：

```bash
open -a ZCode --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=9343
```

## 主题清单

| 目录名 | 名称 | 类型 |
|---|---|---|
| default | 极光蓝 · 玻璃 | 渐变 |
| sunset-gold | 落日熔金 | 渐变 |
| mint-dawn | 薄荷晨雾 | 渐变 |
| cyber-neon | 赛博霓虹 | 渐变 |
| mysterious-revival | 神秘复苏 | 背景图 |
| origami | 折纸 | 背景图 |
| genshin-night / genshin-dawn | 原神 · 星夜 / 晨曦 | 背景图 |
| naruto-hokage / naruto-sasuke | 火影 · 鸣人 / 佐助 | 背景图 |
| dragonball-nimbus / dragonball-super-saiyan | 龙珠 · 筋斗云 / 超级赛亚人 | 背景图 |
| wuthering-echo / wuthering-tide | 鸣潮 · 共鸣 / 声骸 | 背景图 |
| deepspace-dawn / deepspace-star | 恋与深空 · 晨曦 / 星辰 | 背景图 |
| miku-488137 | Miku 488137 | 背景图 |
| dalao-dianyan | 大佬 · 点烟 | 背景图 |

## 自定义主题

### 方式一：任意图片一键生成（推荐）

```bash
node create-theme.mjs --image /path/to/你喜欢的图.jpg --name "我的主题"
bash use-skin.sh 我的主题       # 名字支持中文模糊匹配
```

自动完成：图片分析取色（主色/辅色/基调）→ 判断深浅模式 → 生成完整主题 → 图片设为背景。
可选参数：`--id 英文目录名`、`--appearance dark|light`（默认按图片亮度自动判断）、`--force`（覆盖已有）。
前提：ZCode 带调试端口运行（用过一次 apply-skin.sh 即可）。

### 方式二：手工编写

在 `themes/` 下新建目录，放一个 `theme.json`（可选配一张背景图）：

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

- `appearance`：`dark` 或 `light`（决定系统配色基调）
- `heroImage`：背景图（png/jpg/webp，建议 16:9）；或用 `heroCss` 写任意 CSS 背景
- `colors`：覆盖 ZCode 的界面变量，全部可选。常用键：`background` `sidebar` `panel`
  `header` `card` `cardSelected` `border` `foreground` `foregroundSubtle`
  `foregroundSubtlest` `primary` `brand` `accent` `hover` `selected` `input`
  `inputBorder` `popover` `menu` `terminalBg` 等。
  颜色格式 `#RRGGBB` 或带透明度 `#RRGGBBAA`（结尾两位是透明度，`00` 全透 `ff` 不透）。
  完整变量清单见 `lib/theme.mjs` 的 `VAR_MAP`。

预览生成的 CSS：`node apply.mjs --dry-run --theme themes/my-theme`

## 文件说明

| 文件 | 作用 |
|---|---|
| use-skin.sh | 日常入口：列主题/切换/还原 |
| apply-skin.sh | 一次性流程：重启 ZCode 带端口 + 注入（launchd 系统级执行，有保底拉起） |
| apply.mjs | 注入器（--list / --status / --dry-run / --theme） |
| create-theme.mjs | 图片自动取色生成新主题 |
| restore.mjs | 还原官方外观 |
| relaunch-via-launchd.sh | 被 launchd 调用的重启器（一般不用直接碰） |
| lib/palette.mjs | 颜色映射核心（4 色 → ZCode 界面变量，含主色可见度保障） |
| lib/menu.mjs | use-skin.sh 的交互菜单实现 |
| lib/cdp.mjs | CDP 客户端（零依赖，Node 22+ 自带 WebSocket） |
| themes/ | 全部主题 |
| logs/ | 运行日志 |

## 注意事项

- 皮肤注入是**运行时**的：ZCode 完全退出再用普通方式打开，皮肤会消失，界面回到官方外观
  （重新 `bash apply-skin.sh` 即可恢复）。
- 调试端口只绑定本机回环（127.0.0.1），不对外网开放；但同一台电脑上的其他程序
  也能连这个端口，介意的话用完可以还原并重启 ZCode。
- 不修改 ZCode 安装目录、不改签名、不动会话数据。
- ZCode 升级后如果界面大改，皮肤可能部分失效（变量名变化时），届时用
  `node apply.mjs --status` 排查。

## 许可

MIT（见 LICENSE）。背景图主题中的动漫/IP 形象版权归各自权利人，仅供个人使用。
