# ZCode Skin

<p align="center">
  <a href="./README.md">中文</a> · <strong>English</strong>
</p>

<div align="center">

**Your coding window should look the way you like.**

One image becomes one theme. After setup, switching skins is a single click in the in-app theme center, and one click restores the official UI.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-black)
![Node](https://img.shields.io/badge/node-%3E%3D22-339933)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

</div>

> ## 🆕 1.2.3: uninstaller crash fix
>
> Fixes the `unbound variable` crash in v1.2.2's `uninstall.sh` step 6: when a full-width
> character directly follows `$DIR`, bash merges it into the variable name, so the delete
> confirmation never appeared and the tool directory was left behind. All 4 occurrences
> across the repo now use `${VAR}`, and a new shell lint test fails on any `$VAR` followed
> by a multibyte character. Full history in [CHANGELOG.md](CHANGELOG.md) (Chinese).

## What it is

A local skin switcher for the ZCode desktop client. It injects themes at runtime through loopback
Chrome DevTools Protocol (`127.0.0.1:9343`) and never modifies the app bundle, code signature, or
session data — only CSS variables are overridden, so the UI stays fully native and interactive.

- **One-click switching**: a 🎨 theme center appears in the bottom-right corner of ZCode — theme
  list with color swatches, random theme, upload an image to generate a new theme, and a restore
  button, all without restarting ZCode.
- **One image, one theme**: any PNG / JPG / WebP (≤12MB) becomes a full skin — palette extraction,
  light/dark detection, and accent visibility correction are automatic.
- **22 built-in themes**: 14 image-based (Genshin Impact, Wuthering Waves, Naruto, Love and
  Deepspace, Dragon Ball, Miku, and more) + 8 gradient themes.
- **Skin daemon (LaunchAgent)**: re-injects the skin within seconds if ZCode reloads or updates,
  serves the theme list to the panel, and sends a macOS notification when the debug port is lost.
  It never restarts ZCode on its own.
- **"ZCode 皮肤.app" launcher**: double-click to restore the last skin (system notification on
  success), self-check the daemon, or get instructions when the debug port is missing. The app is
  a thin wrapper; the actual logic lives in `launcher-app.sh` in the repo, so updates don't
  require regenerating it.
- **Reading enhancement** (off by default): an optional 90% theme-aware translucent backdrop for
  AI replies and thinking blocks.
- **Zero dependencies**: Node.js 22+ built-ins only (`node --test` suite, 120 cases).

## Quick start

Requirements: macOS + Node.js 22 or newer. ZCode does not open a debug port by default, so enable
it once:

```bash
bash apply-skin.sh        # quits ZCode → relaunches with port 9343 → injects the default skin
bash install-daemon.sh    # optional: theme center + auto-recovery + notifications
bash make-launcher.sh     # optional: "ZCode 皮肤.app" in ~/Applications
bash uninstall.sh         # remove everything: page injections + daemon + launcher + launchd + tool dir
```

Daily switching never restarts ZCode and takes effect immediately:

```bash
bash use-skin.sh          # interactive menu
bash use-skin.sh 5        # by number
bash use-skin.sh 佐助      # by name (fuzzy Chinese matching; "restore" removes the skin)
```

The relaunch in `apply-skin.sh` runs as a launchd system task with a safety net: whatever fails,
ZCode ends up running. Keep the tool out of Downloads / Desktop / Documents — macOS privacy
protection (TCC) blocks launchd from executing scripts there.

## Make your own theme

1. **Upload from the panel**: "＋ 自定义图片" in the theme center — colors, appearance, and accent
   correction are automatic, same engine as the CLI.
2. **From the terminal**: `node create-theme.mjs --image pic.jpg --name "My Theme"` (supports
   `--id`, `--appearance dark|light`, `--force`).
3. **Let the AI do it**: hand `skill/zcode-skin/SKILL.md` to ZCode or any agent and just say
   "switch to a cyberpunk theme".

Ready-to-copy image prompts live in the [theme prompt gallery](docs/theme-prompts.md) (Chinese).
You can also write a `theme.json` by hand — 39 color keys map to ZCode's interface CSS variables
(see `VAR_MAP` in `lib/theme.mjs`); formats are `#RRGGBB` or `#RRGGBBAA`. New themes appear in the
menu and the panel instantly.

## Built-in themes

| # | Directory | Name | Mode | Type |
|---|---|---|---|---|
| 1 | cyber-neon | 赛博霓虹 | 🌙 | gradient |
| 2 | dalao-dianyan | 大佬 · 点烟 | 🌙 | image |
| 3 | deepspace-dawn | 恋与深空 · 晨曦 | ☀️ | image |
| 4 | deepspace-star | 恋与深空 · 星辰 | 🌙 | image |
| 5 | default | 极光蓝 · 玻璃 | 🌙 | gradient |
| 6 | dragonball-nimbus | 龙珠 · 筋斗云 | ☀️ | image |
| 7 | dragonball-super-saiyan | 龙珠 · 超级赛亚人 | ☀️ | image |
| 8 | forest-rain | 雨林墨绿 | 🌙 | gradient |
| 9 | genshin-dawn | 原神 · 晨曦 | ☀️ | image |
| 10 | genshin-night | 原神 · 星夜 | 🌙 | image |
| 11 | grape-soda | 葡萄气泡 | 🌙 | gradient |
| 12 | miku-488137 | Miku 488137 | ☀️ | image |
| 13 | mint-dawn | 薄荷晨雾 | ☀️ | gradient |
| 14 | mysterious-revival | 神秘复苏 | 🌙 | image |
| 15 | naruto-hokage | 火影 · 鸣人 | 🌙 | image |
| 16 | naruto-sasuke | 火影 · 佐助 | 🌙 | image |
| 17 | origami | 折纸 | 🌙 | image |
| 18 | paper-cream | 宣纸米白 | ☀️ | gradient |
| 19 | sakura-mist | 樱雾粉青 | 🌙 | gradient |
| 20 | sunset-gold | 落日熔金 | 🌙 | gradient |
| 21 | wuthering-echo | 鸣潮 · 共鸣 | 🌙 | image |
| 22 | wuthering-tide | 鸣潮 · 声骸 | 🌙 | image |

Anime artwork belongs to its respective rights holders; for personal use only.

## Command reference

| Command | What it does |
|---|---|
| `bash use-skin.sh [number/name/restore]` | Interactive menu or direct switch |
| `bash install-daemon.sh` / `bash uninstall-daemon.sh` | Install / uninstall the daemon |
| `bash uninstall.sh` | Full uninstall: removes page injections, the daemon, the launcher app, launchd registrations, and /tmp leftovers; asks before deleting the tool directory (`--keep-dir` keeps it, `--yes` skips prompts) |
| `bash make-launcher.sh` | Generate the "ZCode 皮肤.app" launcher |
| `bash apply-skin.sh` | First-time enable / recovery after a normal restart |
| `node apply.mjs --list` / `--status` | List themes / query current skin state |
| `node apply.mjs --theme themes/<name>` | Inject a specific theme |
| `node apply.mjs --panel` / `--remove-panel` | Inject / remove the theme center button |
| `node apply.mjs --dry-run --theme <dir>` | Generate CSS without injecting |
| `node create-theme.mjs --image <file> --name <name>` | Build a theme from an image |
| `node restore.mjs` | Restore the official look |
| `node diag.mjs` | One-shot health check with fix hints |
| `npm test` | Run the test suite (120 cases, zero deps) |

## Honest notes

- Loopback CDP (9343) and the theme API (9344) bind to `127.0.0.1` only, but neither has
  authentication — same-user local processes remain inside the threat boundary. The API does
  reject cross-site browser requests via Origin validation. See [SECURITY.md](SECURITY.md).
- Skins are runtime injections: if ZCode is restarted the normal way (Launchpad/Finder), the debug
  port and the skin disappear; run `bash apply-skin.sh` once to recover. Future ZCode updates that
  rename interface CSS variables may break themes partially — `node apply.mjs --status` tells you
  whether the injection is still live.
- When something looks wrong, run `node diag.mjs` first: it checks the daemon, the debug port, the
  main window, the injection state, `state.json`, and the theme directory, with fix hints per item.

## License and assets

Code is under the [MIT License](LICENSE). The license covers software code only and grants no
rights to characters, trademarks, or third-party artwork. Full documentation is in
[README.md](README.md) (Chinese).

---

**If you like it, star it. And keep switching skins — 22 are never enough.**
