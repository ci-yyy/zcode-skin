// test/theme.test.mjs — loadTheme 校验与 buildSkinCss 生成
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STYLE_ID, VAR_MAP, buildSkinCss, loadTheme } from "../lib/theme.mjs";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zcsk-theme-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeTheme(theme, extraFiles = {}) {
  const themeDir = join(dir, "t");
  await mkdir(themeDir, { recursive: true });
  await writeFile(join(themeDir, "theme.json"), JSON.stringify(theme), "utf8");
  for (const [name, content] of Object.entries(extraFiles)) {
    await copyFile(content, join(themeDir, name));
  }
  return themeDir;
}

test("loadTheme 接受合法主题", async () => {
  const themeDir = await writeTheme({
    id: "my-theme",
    name: "我的主题",
    appearance: "dark",
    colors: { background: "#0a0a0a", primary: "#38bdf8" },
  });
  const theme = await loadTheme(themeDir);
  assert.equal(theme.id, "my-theme");
  assert.equal(theme.colors.primary, "#38bdf8");
});

test("loadTheme 拒绝非法 id", async () => {
  const themeDir = await writeTheme({ id: "带空格 的名字", colors: { background: "#000000" } });
  await assert.rejects(() => loadTheme(themeDir), /id/);
});

test("loadTheme 拒绝 8 位以下十六进制", async () => {
  const themeDir = await writeTheme({ id: "t", colors: { background: "#12345" } });
  await assert.rejects(() => loadTheme(themeDir), /RRGGBB/);
});

test("loadTheme 接受 #RRGGBBAA", async () => {
  const themeDir = await writeTheme({ id: "t", colors: { background: "#11223344" } });
  assert.equal((await loadTheme(themeDir)).colors.background, "#11223344");
});

test("loadTheme 拒绝未知 colors 键", async () => {
  const themeDir = await writeTheme({ id: "t", colors: { notAKey: "#000000" } });
  await assert.rejects(() => loadTheme(themeDir), /未知键/);
});

test("loadTheme 拒绝空主题（无色无背景）", async () => {
  const themeDir = await writeTheme({ id: "t" });
  await assert.rejects(() => loadTheme(themeDir), /空皮肤/);
});

test("loadTheme 拒绝非法 appearance", async () => {
  const themeDir = await writeTheme({ id: "t", colors: { background: "#000000" }, appearance: "blue" });
  await assert.rejects(() => loadTheme(themeDir), /appearance/);
});

test("loadTheme 主题文件缺失时给出可读错误", async () => {
  await assert.rejects(() => loadTheme(join(dir, "nope")), /读不到/);
});

test("buildSkinCss 生成变量覆盖与 color-scheme", async () => {
  const themeDir = await writeTheme({
    id: "t",
    appearance: "light",
    colors: { background: "#ffffff", sidebar: "#f0f0f0", primary: "#0a84ff" },
  });
  const css = await buildSkinCss(await loadTheme(themeDir), themeDir);
  assert.match(css, /:root, :root\.dark \{/);
  assert.match(css, /color-scheme: light !important/);
  assert.match(css, /--color-background: #ffffff !important/);
  assert.match(css, /--color-sidebar: #f0f0f0 !important/);
  assert.match(css, /--color-primary: #0a84ff !important/);
  // 没传的变量不该出现
  assert.ok(!css.includes("--color-card:"));
});

test("buildSkinCss 深色外观", async () => {
  const themeDir = await writeTheme({ id: "t", appearance: "dark", colors: { background: "#000000" } });
  const css = await buildSkinCss(await loadTheme(themeDir), themeDir);
  assert.match(css, /color-scheme: dark !important/);
});

test("buildSkinCss 渐变背景层", async () => {
  const themeDir = await writeTheme({
    id: "t",
    heroCss: "linear-gradient(135deg, #111, #222)",
    colors: { background: "#111111" },
  });
  const css = await buildSkinCss(await loadTheme(themeDir), themeDir);
  assert.match(css, /html \{ background: linear-gradient\(135deg, #111, #222\) !important; \}/);
});

test("buildSkinCss 背景图转 data URL", async () => {
  // 1x1 PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  const pngFile = join(dir, "hero.png");
  await writeFile(pngFile, png);
  const themeDir = await writeTheme(
    { id: "t", heroImage: "hero.png", colors: { background: "#000000" } },
    {},
  );
  await copyFile(pngFile, join(themeDir, "hero.png"));
  const css = await buildSkinCss(await loadTheme(themeDir), themeDir);
  assert.match(css, /html \{ background: url\("data:image\/png;base64,/);
});

test("buildSkinCss 背景图后缀不支持时报错", async () => {
  const themeDir = await writeTheme({ id: "t", heroImage: "hero.gif", colors: { background: "#000000" } });
  await writeFile(join(themeDir, "hero.gif"), "GIF89a", "utf8");
  const theme = await loadTheme(themeDir);
  await assert.rejects(() => buildSkinCss(theme, themeDir), /PNG \/ JPG \/ WebP/);
});

test("VAR_MAP 的值全部是 --color-* 变量名", () => {
  for (const [key, cssVar] of Object.entries(VAR_MAP)) {
    assert.match(cssVar, /^--color-[a-z-]+$/, `键 ${key} 的变量名 ${cssVar} 不合法`);
  }
});
