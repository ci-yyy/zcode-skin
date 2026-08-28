#!/usr/bin/env node
// daemon.mjs — 皮肤守护进程（后台常驻，由 launchd 管理）
//
// 职责：
//   1. 本地 HTTP 服务（127.0.0.1:9344）：供 ZCode 界面里的「🎨 主题中心」面板取主题列表、
//      取主题 CSS、上报「用户刚选了哪套主题」（写进 state.json）
//   2. 巡检（每 5 秒）：ZCode 带调试端口在跑时，皮肤 <style> 丢了自动补注入、
//      主题中心按钮丢了自动补注入（ZCode 升级/刷新页面后会丢）
//   3. 端口探测：ZCode 被普通方式重启（不带端口）时，发一条 macOS 系统通知告知恢复方法。
//      注意：守护进程永远不会主动重启 ZCode——重启必须由用户在终端执行 apply-skin.sh 发起。
//
// 手动前台调试：node daemon.mjs --foreground

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { STYLE_ID, buildSkinCss, loadTheme } from "./lib/theme.mjs";
import { readState, writeState } from "./lib/state.mjs";
import {
  healthScript,
  panelInjectionScript,
  skinInjectionScript,
} from "./lib/inject.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const THEMES_ROOT = join(here, "themes");
const PANEL_SOURCE = readFileSync(join(here, "lib", "panel.js"), "utf8");
// 端口可用环境变量覆盖（测试或多实例场景）：ZCODE_SKIN_CDP_PORT / ZCODE_SKIN_API_PORT
const CDP_PORT = Number(process.env.ZCODE_SKIN_CDP_PORT) || DEFAULT_PORT; // ZCode 的 CDP 端口（默认 9343）
const API_PORT = Number(process.env.ZCODE_SKIN_API_PORT) || 9344;         // 面板数据服务端口（默认 9344）
const POLL_MS = 5000;

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
let cdpc = null;
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

  // 端口在：检查皮肤和面板
  let health;
  try {
    health = await withMainWindow((s) => s.evaluate(healthScript()));
  } catch {
    return; // 窗口还没就绪（ZCode 正在启动），下轮再看
  }
  if (!health) return;

  const { theme } = await readState();
  if (theme && !health.skin) {
    try {
      await injectSkin(theme);
      log(`巡检：皮肤丢失，已重新注入「${theme}」`);
    } catch (e) {
      log(`巡检：重注入失败 ${e.message}`);
    }
  }
  if (!health.panel) {
    try {
      await injectPanel();
      log("巡检：主题中心按钮丢失，已重新注入");
    } catch (e) {
      log(`巡检：面板重注入失败 ${e.message}`);
    }
  }
}

// ---------- HTTP API（供面板） ----------
function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${API_PORT}`);

    if (req.method === "GET" && url.pathname === "/themes") {
      const themes = await listThemesMeta();
      const { theme } = await readState();
      return json(res, 200, { current: theme, themes });
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

    const appliedMatch = url.pathname.match(/^\/applied\/([^/]+)$/);
    if (appliedMatch && (req.method === "POST" || req.method === "GET")) {
      const dir = decodeURIComponent(appliedMatch[1]);
      if (dir === "none") {
        await writeState(null);
        log("面板：还原官方外观");
        return json(res, 200, { ok: true });
      }
      if (dir.includes("..") || dir.includes("/")) {
        return json(res, 400, { ok: false, error: "非法目录名" });
      }
      await writeState(dir);
      log(`面板：切换到「${dir}」`);
      return json(res, 200, { ok: true });
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
