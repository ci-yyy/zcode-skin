// lib/palette.mjs — 主题颜色工具与 4色→ZCode变量 映射
// 4 色主题参数（accent 主色 / secondary 辅色 / surface 底色 / text 文字色）映射到 ZCode 的 37 个语义界面变量。
// 深浅两套策略：深色主题以底色为基调提亮做卡片，浅色主题以底色为基调提白做卡片。

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 8 ? h.slice(0, 6) : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function mix(a, b, t) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const to = (x) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(r1 + (r2 - r1) * t)}${to(g1 + (g2 - g1) * t)}${to(b1 + (b2 - b1) * t)}`;
}
function alpha(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  const to = (x) => Math.round(x).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}${Math.round(a * 255).toString(16).padStart(2, "0")}`;
}
function darken(hex, t) { return mix(hex, "#000000", t); }
function lighten(hex, t) { return mix(hex, "#ffffff", t); }

function buildColors({ accent, secondary, surface, text }, appearance) {
  if (appearance === "light") {
    // 浅色：surface 是偏白底，text 是深色墨
    const card = lighten(surface, 0.35);
    return {
      background: "#00000000",
      backgroundAlt: alpha(surface, 0.55),
      sidebar: alpha(surface, 0.97),
      panel: alpha(card, 0.97),
      header: alpha(surface, 0.97),
      card: alpha(card, 0.96),
      cardSelected: alpha(mix(surface, accent, 0.22), 0.96),
      cardBorder: alpha(accent, 0.22),
      popover: alpha(card, 0.98),
      popoverForeground: mix(text, "#000000", 0.1),
      input: alpha("#ffffff", 0.92),
      inputFocused: alpha("#ffffff", 0.97),
      inputBorder: alpha(accent, 0.35),
      inputBorderHover: alpha(accent, 0.6),
      inputBorderFocused: accent,
      border: alpha(text, 0.14),
      borderHover: alpha(text, 0.28),
      foreground: text,
      foregroundInverse: "#ffffff",
      foregroundSubtle: alpha(text, 0.62),
      foregroundSubtlest: alpha(text, 0.45),
      primary: accent,
      primaryForeground: "#ffffff",
      secondary: alpha(accent, 0.14),
      brand: accent,
      accent: alpha(accent, 0.12),
      hover: alpha(text, 0.07),
      selected: alpha(accent, 0.22),
      surface: alpha(accent, 0.07),
      surfaceHover: alpha(accent, 0.13),
      menu: alpha(card, 0.98),
      menuHover: alpha(accent, 0.16),
      toast: alpha(card, 0.98),
      tooltip: alpha(card, 0.98),
      tooltipForeground: mix(text, "#000000", 0.1),
      tag: alpha(accent, 0.16),
      tabActive: alpha(mix(surface, accent, 0.22), 0.95),
      terminalBg: alpha("#ffffff", 0.92),
      terminalFg: text,
    };
  }
  // 深色：surface 是深底，text 是亮字
  const card = lighten(surface, 0.06);
  const deep = darken(surface, 0.35);
  return {
    background: "#00000000",
    backgroundAlt: alpha(deep, 0.55),
    sidebar: alpha(deep, 0.94),
    panel: alpha(surface, 0.95),
    header: alpha(deep, 0.94),
    card: alpha(card, 0.92),
    cardSelected: alpha(mix(card, accent, 0.2), 0.94),
    cardBorder: alpha(accent, 0.26),
    popover: alpha(card, 0.97),
    popoverForeground: text,
    input: alpha(deep, 0.94),
    inputFocused: alpha(card, 0.96),
    inputBorder: alpha(accent, 0.3),
    inputBorderHover: alpha(accent, 0.55),
    inputBorderFocused: accent,
    border: alpha(text, 0.12),
    borderHover: alpha(text, 0.24),
    foreground: text,
    foregroundInverse: darken(surface, 0.5),
    foregroundSubtle: alpha(text, 0.6),
    foregroundSubtlest: alpha(text, 0.44),
    primary: accent,
    primaryForeground: darken(surface, 0.5),
    secondary: alpha(accent, 0.18),
    brand: accent,
    accent: alpha(accent, 0.16),
    hover: alpha(text, 0.08),
    selected: alpha(secondary, 0.28),
    surface: alpha(text, 0.05),
    surfaceHover: alpha(text, 0.1),
    menu: alpha(card, 0.97),
    menuHover: alpha(accent, 0.2),
    toast: alpha(card, 0.97),
    tooltip: alpha(card, 0.97),
    tooltipForeground: text,
    tag: alpha(secondary, 0.24),
    tabActive: alpha(mix(card, accent, 0.2), 0.94),
    terminalBg: alpha(deep, 0.95),
    terminalFg: text,
  };
}


export { hexToRgb, mix, alpha, darken, lighten, buildColors };

// HSL 亮度
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 主色可见度保障：图片整体很暗/很亮时，取出的主色也会过暗/过亮，
// 直接当按钮色会看不清。在 HSL 空间保住色相（图片的身份色），
// 把饱和度提到可用、明度搬进安全区间：深色主题主色明度 0.52~0.62，浅色 0.38~0.48。
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const to = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function ensureAccentVisible(accent, appearance) {
  const [r, g, b] = hexToRgb(accent);
  let { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.45) s = Math.min(0.7, s + 0.25);      // 太灰的色提饱和
  if (appearance === "dark") {
    if (l < 0.52) l = 0.52;                        // 深色主题：主色要亮
    if (l > 0.72) l = 0.72;
  } else {
    if (l > 0.48) l = 0.48;                        // 浅色主题：主色要深
    if (l < 0.30) l = 0.30;
  }
  return hslToHex(h, s, l);
}

export { luminance, ensureAccentVisible };
