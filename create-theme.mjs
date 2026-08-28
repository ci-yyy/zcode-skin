#!/usr/bin/env node
// create-theme.mjs — 一张图片生成一套主题（自动取色）
//
// 用法：
//   node create-theme.mjs --image /path/to/图片.jpg --name "我的主题"
//   node create-theme.mjs --image ~/Downloads/wall.png --name 名字 --id my-id
//   node create-theme.mjs --image 图.png --name 名字 --appearance dark   # 强制深色（默认按图片亮度自动判断）
//   node create-theme.mjs --image 图.png --name 名字 --force             # 覆盖已有同名主题
//
// 原理：把图片发给 ZCode 渲染进程，用页面里的 canvas 采样像素、统计色彩
// （主色、辅色、整体明暗），再套用与移植主题相同的颜色映射，生成完整主题目录。
// 需要 ZCode 带调试端口运行（用 apply-skin.sh 启动过一次就行）。

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpSession, classifyTargets, DEFAULT_PORT, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { buildColors, darken, ensureAccentVisible, lighten } from "./lib/palette.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function parseArgs(argv) {
  const opts = { image: null, name: null, id: null, appearance: "auto", port: DEFAULT_PORT, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--image") opts.image = argv[++i];
    else if (arg === "--name") opts.name = argv[++i];
    else if (arg === "--id") opts.id = argv[++i];
    else if (arg === "--appearance") opts.appearance = argv[++i];
    else if (arg === "--port") opts.port = Number(argv[++i]);
    else if (arg === "--force") opts.force = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!opts.image) throw new Error("必须用 --image 指定图片路径");
  if (!existsSync(opts.image)) throw new Error(`图片不存在：${opts.image}`);
  const ext = extname(opts.image).toLowerCase();
  if (!MIME[ext]) throw new Error(`只支持 PNG / JPG / WebP，收到：${ext || "（无后缀）"}`);
  if (opts.appearance !== "auto" && opts.appearance !== "dark" && opts.appearance !== "light") {
    throw new Error('--appearance 只能是 auto / dark / light');
  }
  return { ...opts, image: resolve(opts.image), ext };
}

function slugify(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || `custom-${Date.now().toString(36)}`;
}

// 在 ZCode 渲染进程里跑：canvas 缩小采样 → 按色相分桶统计 → 主色/辅色/平均色/亮度
function extractPaletteScript(dataUrl) {
  return `(async () => {
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("图片解码失败"));
        img.src = ${JSON.stringify(dataUrl)};
      });
      const W = 64;
      const H = Math.max(1, Math.round(W * img.height / img.width));
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, W, H);
      const { data } = ctx.getImageData(0, 0, W, H);
      let totalL = 0, sr = 0, sg = 0, sb = 0, n = 0;
      const buckets = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        sr += r; sg += g; sb += b; n++;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        totalL += l;
        const d = max - min;
        if (d === 0) continue;
        const s = d / (1 - Math.abs(2 * l - 1));
        if (s < 0.18 || l < 0.12 || l > 0.92) continue;
        let h;
        if (max === r) h = ((g - b) / d + 6) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        const key = Math.round(h / 30);
        const cur = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0, w: 0 };
        cur.r += r; cur.g += g; cur.b += b; cur.n += 1;
        cur.w += s;
        buckets.set(key, cur);
      }
      const toHex = (r, g, b) => "#" + [r, g, b].map((v) =>
        Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
      const ranked = [...buckets.values()].sort((a, b) => b.w - a.w);
      const accent = ranked[0] ? toHex(ranked[0].r / ranked[0].n, ranked[0].g / ranked[0].n, ranked[0].b / ranked[0].n) : "#38bdf8";
      const secondary = ranked[1] ? toHex(ranked[1].r / ranked[1].n, ranked[1].g / ranked[1].n, ranked[1].b / ranked[1].n) : accent;
      return { ok: true, accent, secondary, avg: toHex(sr / n, sg / n, sb / n), avgL: totalL / n };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  })()`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const name = opts.name || basename(opts.image, extname(opts.image));
  const id = opts.id ? slugify(opts.id) : slugify(name);
  const destDir = join(here, "themes", id);
  if (existsSync(destDir) && !opts.force) {
    throw new Error(`主题目录已存在：${destDir}（换 --id，或加 --force 覆盖）`);
  }

  // 找 ZCode 主窗口
  const { target } = pickMainWindow(classifyTargets(await listTargets(opts.port, { timeoutMs: 2000 })));
  if (!target) {
    throw new Error(`没连上 ZCode 调试端口 ${opts.port}。先跑一次 apply-skin.sh（或确认 ZCode 带端口在运行）再生成主题。`);
  }

  // 发图进渲染进程取色
  const buf = await readFile(opts.image);
  const dataUrl = `data:${MIME[opts.ext]};base64,${buf.toString("base64")}`;
  console.log("正在取色（ZCode 渲染进程 canvas 采样）……");
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  let palette;
  try {
    palette = await session.evaluate(extractPaletteScript(dataUrl));
  } finally {
    session.close();
  }
  if (!palette?.ok) throw new Error(`取色失败：${palette?.error ?? "未知错误"}`);

  const appearance = opts.appearance === "auto"
    ? (palette.avgL < 0.45 ? "dark" : "light")
    : opts.appearance;
  // 图片很暗/很亮时取出的主色会看不清（如深红按钮配黑字），
  // 保色相提亮/压深到安全区间后再参与映射
  const safeAccent = ensureAccentVisible(palette.accent, appearance);
  const skinColors = {
    accent: safeAccent,
    secondary: palette.secondary,
    surface: appearance === "dark" ? darken(palette.avg, 0.5) : lighten(palette.avg, 0.6),
    text: appearance === "dark" ? lighten(palette.avg, 0.82) : darken(palette.avg, 0.74),
  };

  // 落盘主题
  await mkdir(destDir, { recursive: true });
  await copyFile(opts.image, join(destDir, `hero${opts.ext}`));
  const theme = {
    schemaVersion: 1,
    id,
    name,
    appearance,
    heroImage: `hero${opts.ext}`,
    colors: buildColors(skinColors, appearance),
    autoGenerated: { source: basename(opts.image), palette, avgL: Number(palette.avgL.toFixed(3)) },
  };
  await writeFile(join(destDir, "theme.json"), JSON.stringify(theme, null, 2) + "\n");

  console.log(`✅ 主题「${name}」已生成：themes/${id}/`);
  console.log(`   深浅判断：${appearance}（图片平均亮度 ${(palette.avgL * 100).toFixed(0)}%）`);
  console.log(`   取色结果：主色 ${palette.accent} · 辅色 ${palette.secondary} · 基调 ${palette.avg}`);
  console.log(`   立即使用：bash use-skin.sh ${id}`);
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
