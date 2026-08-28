// lib/theme.mjs — 读取主题目录里的 theme.json，生成要注入的 CSS
// 设计原则：皮肤只覆盖 ZCode 的语义 CSS 变量（--color-*），
// 不写界面类名选择器。ZCode 界面升级时变量名比类名稳定得多，皮肤不容易失效。

import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

export const STYLE_ID = "zcode-skin-style";

const HEX_COLOR = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;
const IMAGE_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

// theme.json 的 colors 键 → ZCode 界面里的 CSS 变量名
// （变量清单来自 app.asar 内 out/renderer/assets/styles-*.css 的实测提取，共 130 个语义变量，这里挑核心的）
export const VAR_MAP = {
  background: "--color-background",
  backgroundAlt: "--color-background-alt",
  sidebar: "--color-sidebar",
  panel: "--color-panel",
  header: "--color-header",
  card: "--color-card",
  cardSelected: "--color-card-selected",
  cardBorder: "--color-card-border",
  popover: "--color-popover",
  popoverForeground: "--color-popover-foreground",
  input: "--color-input",
  inputFocused: "--color-input-focused",
  inputBorder: "--color-input-border",
  inputBorderHover: "--color-input-border-hover",
  inputBorderFocused: "--color-input-border-focused",
  border: "--color-border",
  borderHover: "--color-border-hover",
  foreground: "--color-foreground",
  foregroundInverse: "--color-foreground-inverse",
  foregroundSubtle: "--color-foreground-subtle",
  foregroundSubtlest: "--color-foreground-subtlest",
  primary: "--color-primary",
  primaryForeground: "--color-primary-foreground",
  secondary: "--color-secondary",
  brand: "--color-brand",
  accent: "--color-accent",
  hover: "--color-hover",
  selected: "--color-selected",
  surface: "--color-surface",
  surfaceHover: "--color-surface-hover",
  menu: "--color-menu",
  menuHover: "--color-menu-hover",
  toast: "--color-toast",
  tooltip: "--color-tooltip",
  tooltipForeground: "--color-tooltip-foreground",
  tag: "--color-tag",
  tabActive: "--color-tab-active",
  terminalBg: "--color-terminal-bg",
  terminalFg: "--color-terminal-fg",
};

export async function loadTheme(themeDir) {
  let theme;
  try {
    theme = JSON.parse(await readFile(join(themeDir, "theme.json"), "utf8"));
  } catch (error) {
    throw new Error(`读不到 ${join(themeDir, "theme.json")}：${error.message}`);
  }
  if (!theme || typeof theme !== "object") throw new Error("theme.json 内容必须是对象");
  if (!theme.id || !/^[a-z0-9][a-z0-9-]*$/i.test(theme.id)) {
    throw new Error('theme.json 需要合法的 "id"（字母数字连字符）');
  }
  const colors = theme.colors ?? {};
  if (!theme.heroCss && !theme.heroImage && Object.keys(colors).length === 0) {
    throw new Error("主题既没有颜色也没有背景，等于空皮肤");
  }
  for (const [key, value] of Object.entries(colors)) {
    if (!(key in VAR_MAP)) throw new Error(`colors 里有未知键 "${key}"，可用键见 VAR_MAP`);
    if (typeof value !== "string" || !HEX_COLOR.test(value.trim())) {
      throw new Error(`colors.${key} 必须是 #RRGGBB 或 #RRGGBBAA 格式，收到：${value}`);
    }
  }
  if (theme.appearance && theme.appearance !== "dark" && theme.appearance !== "light") {
    throw new Error('appearance 只能是 "dark" 或 "light"');
  }
  return theme;
}

// 背景层：画在 <html> 上，主界面变透明后就会透出这张背景
async function buildHeroLayer(theme, themeDir) {
  if (theme.heroImage) {
    const file = join(themeDir, theme.heroImage);
    const mime = IMAGE_MIME[extname(file).toLowerCase()];
    if (!mime) throw new Error(`背景图只支持 PNG / JPG / WebP：${theme.heroImage}`);
    const buf = await readFile(file);
    const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
    return `html { background: url("${dataUrl}") center / cover no-repeat !important; }`;
  }
  if (typeof theme.heroCss === "string" && theme.heroCss.trim()) {
    return `html { background: ${theme.heroCss.trim()} !important; }`;
  }
  return "";
}

export async function buildSkinCss(theme, themeDir) {
  const hero = await buildHeroLayer(theme, themeDir);
  const colors = theme.colors ?? {};
  const declarations = Object.entries(VAR_MAP)
    .filter(([key]) => colors[key])
    .map(([key, cssVar]) => `  ${cssVar}: ${colors[key].trim()} !important;`);

  const parts = [
    `/* ZCode Skin · ${theme.name || theme.id} · 由 apply.mjs 自动注入，手动修改会被覆盖 */`,
  ];
  if (hero) parts.push(hero);
  // :root.dark 的优先级压过应用自带的浅色/深色两套定义，
  // 皮肤配色与 ZCode 当前外观设置无关，保持稳定
  parts.push(
    `:root, :root.dark {\n`
    + `  color-scheme: ${theme.appearance === "light" ? "light" : "dark"} !important;\n`
    + declarations.join("\n")
    + `\n}`,
  );
  return parts.join("\n\n");
}
