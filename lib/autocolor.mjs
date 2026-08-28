// lib/autocolor.mjs — 自动取色：把一张图在 ZCode 渲染进程里采样出主色/辅色/亮度，
// 再套 palette.mjs 的映射生成完整主题。create-theme.mjs（终端）和 daemon.mjs（面板上传）共用。

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { CdpSession } from "./cdp.mjs";
import { buildColors, darken, ensureAccentVisible, lighten } from "./palette.mjs";

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export function imageMime(file) {
  return MIME[extname(file).toLowerCase()] || null;
}

export function slugify(text) {
  const slug = String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || `custom-${Date.now().toString(36)}`;
}

// 在 ZCode 渲染进程里跑：canvas 缩小采样 → 按色相分桶统计 → 主色/辅色/平均色/亮度
export function extractPaletteScript(dataUrl) {
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

// 从图片文件生成主题目录。session = 已连上 ZCode 主窗口的 CdpSession。
// 返回 { dir, name, appearance }；失败抛错。
export async function createThemeFromImage({ session, imagePath, name, id, appearance = "auto", force = false, themesRoot }) {
  if (!existsSync(imagePath)) throw new Error(`图片不存在：${imagePath}`);
  const ext = extname(imagePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`只支持 PNG / JPG / WebP，收到：${ext || "（无后缀）"}`);
  if (appearance !== "auto" && appearance !== "dark" && appearance !== "light") {
    throw new Error("--appearance 只能是 auto / dark / light");
  }
  const themeName = name || basename(imagePath, ext);
  const themeId = id ? slugify(id) : slugify(themeName);
  const destDir = join(themesRoot, themeId);
  if (existsSync(destDir) && !force) {
    throw new Error(`同名主题已存在：${themeId}（换个名字，或让面板覆盖它）`);
  }

  const buf = await readFile(imagePath);
  const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  const palette = await session.evaluate(extractPaletteScript(dataUrl));
  if (!palette?.ok) throw new Error(`取色失败：${palette?.error ?? "未知错误"}`);

  const finalAppearance = appearance === "auto"
    ? (palette.avgL < 0.45 ? "dark" : "light")
    : appearance;
  // 图片很暗/很亮时取出的主色会看不清（如深红按钮配黑字），
  // 保色相提亮/压深到安全区间后再参与映射
  const safeAccent = ensureAccentVisible(palette.accent, finalAppearance);
  const skinColors = {
    accent: safeAccent,
    secondary: palette.secondary,
    surface: finalAppearance === "dark" ? darken(palette.avg, 0.5) : lighten(palette.avg, 0.6),
    text: finalAppearance === "dark" ? lighten(palette.avg, 0.82) : darken(palette.avg, 0.74),
  };

  await mkdir(destDir, { recursive: true });
  await copyFile(imagePath, join(destDir, `hero${ext}`));
  const theme = {
    schemaVersion: 1,
    id: themeId,
    name: themeName,
    appearance: finalAppearance,
    heroImage: `hero${ext}`,
    colors: buildColors(skinColors, finalAppearance),
    autoGenerated: { source: basename(imagePath), palette, avgL: Number(palette.avgL.toFixed(3)) },
  };
  await writeFile(join(destDir, "theme.json"), JSON.stringify(theme, null, 2) + "\n");
  return { dir: themeId, name: themeName, appearance: finalAppearance };
}
