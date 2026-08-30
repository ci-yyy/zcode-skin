#!/usr/bin/env node
// daemon.mjs — 皮肤守护进程（后台常驻，由 launchd 管理）
//
// 职责：
//   1. 本地 HTTP 服务（127.0.0.1:9344）：供 ZCode 界面里的「🎨 主题中心」面板
//      取主题列表 / 取主题 CSS / 上报切换 / 上传图片建主题 / 读写设置开关
//      （路由实现在 lib/http-api.mjs，这里只负责装配和生命周期）
//   2. 巡检（每 5 秒，受「皮肤常驻」开关控制，关掉就只维持 API 不注入）：
//      皮肤 <style> 丢了补皮肤、主题中心丢了补面板、阅读增强开了没在就补
//   3. 端口探测：ZCode 被普通方式重启（端口消失）时发 macOS 系统通知告知恢复方法。
//      守护进程永远不会主动重启 ZCode——重启必须由用户在终端执行 apply-skin.sh 发起。
//
// 手动前台调试：node daemon.mjs --foreground
// 端口可用环境变量覆盖（测试场景）：ZCODE_SKIN_CDP_PORT / ZCODE_SKIN_API_PORT

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
import { createRequestHandler } from "./lib/http-api.mjs";

// 兼容旧引用（1.2.0 及之前从 daemon.mjs 导入 createRequestHandler 的用法）
export { createRequestHandler };

const here = dirname(fileURLToPath(import.meta.url));
const THEMES_ROOT = join(here, "themes");
const PANEL_SOURCE = readFileSync(join(here, "lib", "panel.js"), "utf8");
const CDP_PORT = Number(process.env.ZCODE_SKIN_CDP_PORT) || DEFAULT_PORT; // ZCode 的 CDP 端口（默认 9343）
const API_PORT = Number(process.env.ZCODE_SKIN_API_PORT) || 9344;         // 面板数据服务端口（默认 9344）
const POLL_MS = 5000;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024; // 上传图片上限 12MB（足够当壁纸）
const MAX_CSS_BYTES = 16 * 1024 * 1024;    // 注入 CSS 体积上限（背景图 base64 后很容易超）
const LOG_MAX_BYTES = 1024 * 1024;         // 日志超过 1MiB 轮转，只留一份备份

// ---------- 日志 ----------
const LOG_FILE = join(here, "logs", "daemon.log");
mkdirSync(join(here, "logs"), { recursive: true });
function log(msg) {
  try {
    // 简单轮转：超限先改名为 .1（覆盖旧备份），日志目录最多占 2 MiB 左右
    if (statSync(LOG_FILE).size > LOG_MAX_BYTES) {
      renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    // 文件还不存在（首次写入）或 rename 竞争失败，直接照常追加
  }
  const line = `[${new Date().toISOString()}] ${msg}`;
  appendFileSync(LOG_FILE, line + "\n");
  // launchd 场景下 stdout 没人看；只有前台调试时才打印
  if (process.argv.includes("--foreground")) process.stdout.write(line + "\n");
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
  if (css.length > MAX_CSS_BYTES) {
    throw Object.assign(
      new Error(`主题过大（CSS ${(css.length / 1024 / 1024).toFixed(1)}MB，上限 16MB）：请换小一点的背景图`),
      { code: "THEME_TOO_LARGE" },
    );
  }
  return { theme, css };
}

// ---------- CDP 操作 ----------
// 会话缓存：巡检每 5 秒一次，每次新建 WebSocket 再关掉既浪费也刷日志。
// 以 webSocketDebuggerUrl 为键缓存；不可用（页面刷新/关闭）就换新。
let cachedSession = null;
let cachedUrl = null;

function discardCachedSession() {
  if (cachedSession) {
    try { cachedSession.close(); } catch {}
  }
  cachedSession = null;
  cachedUrl = null;
}

async function withMainWindow(fn) {
  const targets = await listTargets(CDP_PORT, { timeoutMs: 2000 });
  const { target } = pickMainWindow(classifyTargets(targets));
  if (!target) return null;

  // 复用缓存：URL 没变且连接还开着
  if (!cachedSession || cachedUrl !== target.webSocketDebuggerUrl || !cachedSession.isOpen()) {
    discardCachedSession();
    cachedSession = await new CdpSession(target.webSocketDebuggerUrl).open();
    cachedUrl = target.webSocketDebuggerUrl;
  }
  try {
    return await fn(cachedSession);
  } catch (error) {
    // 命令失败多半是连接死了（页面刷新），丢弃缓存，下轮重连
    discardCachedSession();
    throw error;
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
  notify("ZCode 皮肤", `检测到 ZCode 没带调试端口，皮肤不可用。需要恢复请执行：bash ${join(here, "apply-skin.sh")}`);
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
    // 常驻关了或本来就没选过主题 → 用户已明确不需要自动恢复，不弹通知
    const state = await readState();
    if (sawPortUp && state.persistence && state.theme) notifyPortMissing();
    sawPortUp = false;
    // ZCode 没在跑时缓存的老连接必然失效，顺手清掉
    discardCachedSession();
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
  if (!health || health.notReady) return; // DOM 未解析（刚重启），下轮再看

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
  // 主题中心按钮独立于皮肤维护：还原官方外观（theme=null）后按钮也要在，
  // 否则用户没法再从面板选主题
  if (!health.panel) {
    try {
      await injectPanel();
      log("巡检：主题中心按钮丢失，已重新注入");
    } catch (e) {
      log(`巡检：面板重注入失败 ${e.message}`);
    }
  }
  if (state.readingEnhance && !health.reading) {
    try {
      await injectReading();
      log("巡检：阅读增强丢失，已重新注入");
    } catch (e) {
      log(`巡检：阅读增强重注入失败 ${e.message}`);
    }
  }
}

// ---------- HTTP API ----------
// 路由实现在 lib/http-api.mjs，服务在文件末尾装配

// 直接执行才启动服务/巡检；测试 import createRequestHandler 时不带副作用
const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

const server = isMain ? http.createServer(createRequestHandler({
  listThemes: listThemesMeta,
  buildCss: buildCssForDir,
  withMainWindow,
  readState,
  updateState,
  createThemeFromImage,
  log,
  maxCssBytes: MAX_CSS_BYTES,
  maxUploadBytes: MAX_UPLOAD_BYTES,
  themesRoot: THEMES_ROOT,
})) : null;

if (isMain) {
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      log(`端口 ${API_PORT} 已被占用（大概率已有一个守护进程在跑），本进程退出`);
      process.exit(0); // 干净退出：plist 配了 SuccessfulExit=false，exit(0) 不会被 launchd 重拉
    }
    log(`HTTP 服务出错：${error.message}`);
    process.exit(1);
  });

  server.listen(API_PORT, "127.0.0.1", () => {
    log(`daemon 已启动：API http://127.0.0.1:${API_PORT} · 巡检 CDP :${CDP_PORT} 每 ${POLL_MS / 1000}s`);
  });

  // ---------- 保活 ----------
  setInterval(() => pollOnce().catch((e) => log(`巡检异常 ${e.message}`)), POLL_MS);
  pollOnce().catch(() => {});

  process.on("unhandledRejection", (reason) => {
    // 记日志继续跑：巡检/请求路径的杂散 rejection 大多自愈（下轮巡检重试）
    log(`未处理的 Promise 拒绝：${String(reason?.message || reason)}`);
  });
  process.on("uncaughtException", (error) => {
    // uncaughtException 后进程状态未定义，安全做法是退出让 launchd 拉起干净进程；
    // plist 的 KeepAlive 配了 SuccessfulExit=false，exit(1) 会触发重启
    log(`未捕获异常，进程退出（launchd 会拉起新实例）：${error?.stack || error}`);
    discardCachedSession();
    server.close();
    process.exit(1);
  });

  process.on("SIGTERM", () => {
    log("收到 SIGTERM，退出");
    discardCachedSession();
    server.close();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    log("收到 SIGINT，退出");
    discardCachedSession();
    server.close();
    process.exit(0);
  });
}
