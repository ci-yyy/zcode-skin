// test/palette.test.mjs — buildColors 映射与 ensureAccentVisible 边界
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alpha, buildColors, darken, ensureAccentVisible, lighten, luminance, mix, hexToRgb,
} from "../lib/palette.mjs";
import { VAR_MAP } from "../lib/theme.mjs";

const DARK = { accent: "#38bdf8", secondary: "#818cf8", surface: "#0f172a", text: "#e2e8f0" };
const LIGHT = { accent: "#0a84ff", secondary: "#5e5ce6", surface: "#f5f5f4", text: "#1c1917" };

test("hexToRgb 解析 6/8 位", () => {
  assert.deepEqual(hexToRgb("#38bdf8"), [0x38, 0xbd, 0xf8]);
  assert.deepEqual(hexToRgb("#38bdf880"), [0x38, 0xbd, 0xf8]);
});

test("mix 混合两端点", () => {
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
});

test("alpha 生成 8 位十六进制", () => {
  assert.equal(alpha("#38bdf8", 1), "#38bdf8ff");
  assert.equal(alpha("#38bdf8", 0), "#38bdf800");
});

test("darken / lighten 方向正确", () => {
  assert.equal(darken("#808080", 1), "#000000");
  assert.equal(lighten("#808080", 1), "#ffffff");
});

test("buildColors 深色：主色直接透传、文字为 text", () => {
  const colors = buildColors(DARK, "dark");
  assert.equal(colors.primary, DARK.accent);
  assert.equal(colors.brand, DARK.accent);
  assert.equal(colors.foreground, DARK.text);
  assert.equal(colors.terminalFg, DARK.text);
  assert.equal(colors.background, "#00000000");
});

test("buildColors 浅色：背景透明、卡片提亮", () => {
  const colors = buildColors(LIGHT, "light");
  assert.equal(colors.primary, LIGHT.accent);
  assert.equal(colors.foreground, LIGHT.text);
  assert.equal(colors.background, "#00000000");
  assert.equal(colors.terminalBg, "#ffffffeb"); // 0.92 透明度
});

test("buildColors 覆盖全部变量键（与 VAR_MAP 对齐）", () => {
  for (const appearance of ["dark", "light"]) {
    const colors = buildColors(appearance === "dark" ? DARK : LIGHT, appearance);
    for (const key of Object.keys(VAR_MAP)) {
      assert.ok(typeof colors[key] === "string" && /^#[0-9a-f]{6,8}$/i.test(colors[key]),
        `${appearance} 的 ${key} 缺失或格式错：${colors[key]}`);
    }
  }
});

test("luminance：纯黑 0 纯白 1", () => {
  assert.ok(luminance("#000000") < 0.01);
  assert.ok(luminance("#ffffff") > 0.99);
});

test("ensureAccentVisible 深色：过暗主色被提亮", () => {
  const fixed = ensureAccentVisible("#0a0a0a", "dark");
  const lum = luminance(fixed);
  assert.ok(lum > luminance("#0a0a0a") * 10, `提亮不足：${fixed}`);
  // 输出仍是合法 hex
  assert.match(fixed, /^#[0-9a-f]{6}$/i);
});

test("ensureAccentVisible 深色：过亮主色被压暗", () => {
  const fixed = ensureAccentVisible("#f8f8f8", "dark");
  assert.ok(luminance(fixed) < luminance("#f8f8f8"), `压暗失败：${fixed}`);
});

test("ensureAccentVisible 浅色：过亮主色被压深", () => {
  const fixed = ensureAccentVisible("#f0f0f0", "light");
  assert.ok(luminance(fixed) < luminance("#f0f0f0"), `压深失败：${fixed}`);
});

test("ensureAccentVisible 浅色：过暗主色被提亮", () => {
  const fixed = ensureAccentVisible("#101010", "light");
  assert.ok(luminance(fixed) > luminance("#101010"), `提亮失败：${fixed}`);
});

test("ensureAccentVisible 灰色主色饱和度被提升", () => {
  // 纯灰 HSL 饱和度 0，校正后应不再是零饱和（RGB 三通道不全相等）
  const fixed = ensureAccentVisible("#808080", "dark");
  const [r, g, b] = hexToRgb(fixed);
  assert.ok(r !== g || g !== b, `饱和度未提升：${fixed}`);
});

test("ensureAccentVisible 安全区内的颜色基本不动", () => {
  const input = "#4f9cf9"; // 深色安全区内的亮蓝
  const fixed = ensureAccentVisible(input, "dark");
  assert.equal(hexToRgb(fixed).join(","), hexToRgb(input).join(","));
});
