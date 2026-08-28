#!/usr/bin/env node
// daemon.mjs — 皮肤守护进程（后台常驻，由 launchd 管理）
//
// 职责：
//   1. 本地 HTTP 服务（127.0.0.1:9344）：供 ZCode 界面里的「🎨 主题中心」面板
//      取主题列表 / 取主题 CSS / 上报切换 / 上传图片建主题 / 读写设置开关
//   2. 巡检（每 5 秒，受「皮肤常驻」开关控制，关掉就只维持 API 不注入）：
//      皮肤 <style> 丢了补皮肤、主题中心丢了补面板、阅读增强开了没在就补
//   3. 端口探测：ZCode 被普通方式重启（端口消失）时发 macOS 系统通知告知恢复方法。
//      守护进程永远不会主动重启 ZCode——重启必须由用户在终端执行 apply-skin.sh 发起。
//
// 手动前台调试：node daemon.mjs --foreground
// 端口可用环境变量覆盖（测试场景）：ZCODE_SKIN_CDP_PORT / ZCODE_SKIN_API_PORT

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { STYLE_ID, buildSkinCss, loadTheme } from "./lib/theme.mjs";
import { readState, updateState } from "./lib/state.mjs";
import { createThemeFromImage } from "./lib/autocolor.mjs";
import {
  READING_CSS,
  healthScript,
  panelInjectionScript,
  readingInjectionScript,
  skinInjectionScript,
} from "./lib/inject.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const THEMES_ROOT = join(here, "themes");
const PANEL_SOURCE = readFileSync(join(here, "lib", "panel.js"), "utf8");
const CDP_PORT = Number(process.env.ZCODE_SKIN_CDP_PORT) || DEFAULT_PORT; // ZCode 的 CDP 端口（默认 9343）
const API_PORT = Number(process.env.ZCODE_SKIN_API_PORT) || 9344;         // 面板数据服务端口（默认 9344）
const POLL_MS = 5000;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 上传图片上限 20MB

// ---------- 日志 ----------
const LOG_FILE = join(here, "logs", "daemon.log");
mkdirSync(join(here, "logs"), { recursive: true });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(LOG_FILE, line + "\n");
  if (process.argv.includes("--foreground")) console.log(line);
}

// ---------- 主题工具 ----------
async function listThemesMeta() {
  const { readdir } = await import("node:fs/promises");
  const dirs = (await readdir(THEMES_ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const themes = [];
  for (const dir of dirs) {
    try {
      const theme = await loadTheme(join(THEMES_ROOT, dir));
      themes.push({
        dir,
        name: theme.name || dir,
        appearance: theme.appearance === "light" ? "light" : "dark",
        kind: theme.heroImage ? "image" : theme.heroCss ? "gradient" : "plain",
        swatches: pickSwatches(theme),
      });
    } catch {
      // 无效主题目录跳过
    }
  }
  return themes;
}

// 挑 4 个代表色给面板当色卡
function pickSwatches(theme) {
  const colors = theme.colors ?? {};
  const picks = [colors.brand, colors.primary, colors.card, colors.sidebar, colors.backgroundAlt];
  return picks.filter(Boolean).slice(0, 4);
}

async function buildCssForDir(dir) {
  const theme = await loadTheme(join(THEMES_ROOT, dir));
  const css = await buildSkinCss(theme, join(THEMES_ROOT, dir));
  return { theme, css };
}

// ---------- CDP 操作 ----------
async function withMainWindow(fn) {
  const targets = await listTargets(CDP_PORT, { timeoutMs: 2000 });
  const { target } = pickMainWindow(classifyTargets(targets));
  if (!target) return null;
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    return await fn(session);
  } finally {
    session.close();
  }
}

async function injectSkin(dir) {
  const { theme, css } = await buildCssForDir(dir);
  const result = await withMainWindow((s) => s.evaluate(skinInjectionScript(css, theme.id)));
  if (!result?.applied) throw new Error(`注入失败：${result?.error || "无返回"}`);
  return theme;
}

async function injectPanel() {
  const script = panelInjectionScript(PANEL_SOURCE, { port: API_PORT, styleId: STYLE_ID });
  // panel.js 返回 { injected: true } 或 { injected: false, reason }（已存在时不重复注入）
  const result = await withMainWindow((s) => s.evaluate(script));
  if (!result || typeof result.injected !== "boolean") {
    throw new Error("面板注入失败：无返回");
  }
  return result;
}

async function injectReading() {
  return withMainWindow((s) => s.evaluate(readingInjectionScript(READING_CSS)));
}

// ---------- 系统通知 ----------
let lastNotifyTime = 0;
function notify(title, message) {
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}"`;
  spawn("osascript", ["-e", script], { stdio: "ignore", detached: true }).unref();
}

function notifyPortMissing() {
  const now = Date.now();
  if (now - lastNotifyTime < 10 * 60 * 1000) return; // 10 分钟内不重复弹
  lastNotifyTime = now;
  log("ZCode 不带调试端口在运行（或没在运行），已发系统通知");
  notify("ZCode 皮肤", "检测到 ZCode 没带调试端口，皮肤不可用。需要恢复请执行：bash ~/zcode-skin/apply-skin.sh");
}

// ---------- 巡检循环 ----------
let sawPortUp = false;
async function pollOnce() {
  let portUp = false;
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
    portUp = res.ok;
  } catch {
    portUp = false;
  }

  if (!portUp) {
    if (sawPortUp) notifyPortMissing();
    sawPortUp = false;
    return;
  }
  sawPortUp = true;

  const state = await readState();

  let health;
  try {
    health = await withMainWindow((s) => s.evaluate(healthScript()));
  } catch {
    return; // 窗口还没就绪（ZCode 正在启动），下轮再看
  }
  if (!health) return;

  // 皮肤常驻关闭时：不注入、不维护，但已注入的东西也不主动撤（本次会话继续用）
  if (!state.persistence) return;

  if (state.theme && !health.skin) {
    try {
      await injectSkin(state.theme);
      log(`巡检：皮肤丢失，已重新注入「${state.theme}」`);
    } catch (e) {
      log(`巡检：重注入失败 ${e.message}`);
    }
  }
  if (state.theme && !health.panel) {
    try {
      await injectPanel();
      log("巡检：主题中心按钮丢失，已重新注入");
    } catch (e) {
      log(`巡检：面板重注入失败 ${e.message}`);
    }
  }
  if (state.theme && state.readingEnhance && !health.reading) {
    try {
      await injectReading();
      log("巡检：阅读增强丢失，已重新注入");
    } catch (e) {
      log(`巡检：阅读增强重注入失败 ${e.message}`);
    }
  }
}

// ---------- 请求体读取 ----------
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`上传内容超过 ${Math.round(limit / 1024 / 1024)}MB 上限`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------- HTTP API（供面板） ----------
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);
    if (req.method === "OPTIONS") return json(res, 204, {});

    if (req.method === "GET" && url.pathname === "/themes") {
      const themes = await listThemesMeta();
      const state = await readState();
      return json(res, 200, {
        current: state.theme,
        themes,
        settings: {
          persistence: state.persistence,
          readingEnhance: state.readingEnhance,
          miniButton: state.miniButton,
        },
      });
    }

    const cssMatch = url.pathname.match(/^\/css\/([^/]+)$/);
    if (req.method === "GET" && cssMatch) {
      const dir = decodeURIComponent(cssMatch[1]);
      if (dir.includes("..") || dir.includes("/")) {
        return json(res, 400, { ok: false, error: "非法目录名" });
      }
      try {
        const { theme, css } = await buildCssForDir(dir);
        return json(res, 200, { ok: true, id: theme.id, css });
      } catch (e) {
        return json(res, 404, { ok: false, error: `主题不存在或无效：${e.message}` });
      }
    }

    // 随机主题：从全部主题里挑一个（尽量避开当前）
    if (req.method === "GET" && url.pathname === "/random") {
      const themes = await listThemesMeta();
      if (themes.length === 0) return json(res, 404, { ok: false, error: "没有可用主题" });
      const state = await readState();
      const pool = themes.length > 1 ? themes.filter((t) => t.dir !== state.theme) : themes;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const { theme, css } = await buildCssForDir(pick.dir);
      const applied = await withMainWindow((s) => s.evaluate(skinInjectionScript(css, theme.id)));
      if (!applied?.applied) return json(res, 500, { ok: false, error: "注入失败" });
      await updateState({ theme: pick.dir });
      log(`面板：随机切换到「${pick.dir}」`);
      return json(res, 200, { ok: true, dir: pick.dir, name: pick.name, id: theme.id, css });
    }

    const appliedMatch = url.pathname.match(/^\/applied\/([^/]+)$/);
    if (appliedMatch && (req.method === "POST" || req.method === "GET")) {
      const dir = decodeURIComponent(appliedMatch[1]);
      if (dir === "none") {
        await updateState({ theme: null });
        log("面板：还原官方外观");
        return json(res, 200, { ok: true });
      }
      if (dir.includes("..") || dir.includes("/")) {
        return json(res, 400, { ok: false, error: "非法目录名" });
      }
      await updateState({ theme: dir });
      log(`面板：切换到「${dir}」`);
      return json(res, 200, { ok: true });
    }

    // 设置开关：persistence / readingEnhance / miniButton
    const settingMatch = url.pathname.match(/^\/settings\/(persistence|readingEnhance|miniButton)$/);
    if (settingMatch && req.method === "POST") {
      const key = settingMatch[1];
      const body = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}");
      if (typeof body.value !== "boolean") {
        return json(res, 400, { ok: false, error: "需要 { value: true/false }" });
      }
      const state = await updateState({ [key]: body.value });
      log(`面板：设置 ${key} = ${body.value}`);

      if (key === "readingEnhance" && body.value) {
        await injectReading().catch((e) => log(`阅读增强注入失败 ${e.message}`));
      }
      if (key === "readingEnhance" && !body.value) {
        // 关闭：直接移除页面里的阅读增强样式
        await withMainWindow((s) => s.evaluate(
          `(() => { document.getElementById("zcsk-reading")?.remove(); return true; })()`,
        )).catch(() => {});
      }
      return json(res, 200, { ok: true, state: { persistence: state.persistence, readingEnhance: state.readingEnhance, miniButton: state.miniButton } });
    }

    // 上传图片建主题（multipart 简化实现：面板用 FormData）
    if (req.method === "POST" && url.pathname === "/upload-theme") {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) {
        return json(res, 400, { ok: false, error: "需要 multipart/form-data 上传" });
      }
      const body = await readBody(req, MAX_UPLOAD_BYTES);
      // 解析 multipart：拿文件块 + name 字段
      const boundary = Buffer.from(`--${contentType.split("boundary=")[1]}`, "binary");
      const parts = [];
      let idx = body.indexOf(boundary);
      while (idx !== -1) {
        const next = body.indexOf(boundary, idx + boundary.length);
        if (next === -1) break;
        let part = body.subarray(idx + boundary.length + 2, next - 2); // 去掉 \r\n 前后缀
        const headerEnd = part.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const headers = part.subarray(0, headerEnd).toString("utf8");
          parts.push({ headers, data: part.subarray(headerEnd + 4) });
        }
        idx = next;
      }
      const filePart = parts.find((p) => /filename="[^"]+"/.test(p.headers));
      const namePart = parts.find((p) => /name="name"/.test(p.headers) && !/filename=/.test(p.headers));
      if (!filePart) return json(res, 400, { ok: false, error: "没收到图片文件" });
      const filename = (filePart.headers.match(/filename="([^"]+)"/) || [])[1] || "upload.png";
      const ext = (filename.match(/(\.[a-z0-9]+)$/i) || [])[1] || "";
      if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext.toLowerCase())) {
        return json(res, 400, { ok: false, error: `只支持 PNG/JPG/WebP，收到：${ext || "无后缀"}` });
      }
      const customName = namePart ? namePart.data.toString("utf8").trim() : "";

      // 存到临时文件 → 走和 create-theme.mjs 完全相同的建主题流程
      const { writeFile, rm } = await import("node:fs/promises");
      const tmpFile = join(here, "logs", `upload-${Date.now()}${ext.toLowerCase()}`);
      await writeFile(tmpFile, filePart.data);
      try {
        const result = await withMainWindow((s) => createThemeFromImage({
          session: s,
          imagePath: tmpFile,
          name: customName || null,
          id: null,
          appearance: "auto",
          force: true, // 面板上传同名覆盖
          themesRoot: THEMES_ROOT,
        }));
        log(`面板：上传图片生成主题「${result.dir}」`);
        return json(res, 200, { ok: true, dir: result.dir, name: result.name, appearance: result.appearance });
      } finally {
        await rm(tmpFile, { force: true });
      }
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, pid: process.pid });
    }

    json(res, 404, { ok: false, error: "not found" });
  } catch (e) {
    json(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(API_PORT, "127.0.0.1", () => {
  log(`daemon 已启动：API http://127.0.0.1:${API_PORT} · 巡检 CDP :${CDP_PORT} 每 ${POLL_MS / 1000}s`);
});

// ---------- 保活 ----------
setInterval(() => pollOnce().catch((e) => log(`巡检异常 ${e.message}`)), POLL_MS);
pollOnce().catch(() => {});

process.on("SIGTERM", () => {
  log("收到 SIGTERM，退出");
  server.close();
  process.exit(0);
});
process.on("SIGINT", () => {
  log("收到 SIGINT，退出");
  server.close();
  process.exit(0);
});
