#!/usr/bin/env node
// diag.mjs — 一站式体检：守护进程 / ZCode 调试端口 / 主窗口 / state.json / 主题目录 / 皮肤状态
// 一次跑完全部检查，给出哪里断了和对应的修复指引。用法：node diag.mjs [--port 9343]
// 体检工具自己必须比被检查的环境更结实：每个检查独立兜底，单项失败只降级不中断。

import { access, readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { statusScript } from "./lib/inject.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CDP_PORT = Number(process.argv[process.argv.indexOf("--port") + 1]) || DEFAULT_PORT;
const API_PORT = 9344;
const STATE_FILE = join(here, "state.json");
const THEMES_ROOT = join(here, "themes");

const rows = [];
function report(ok, label, detail) {
  rows.push({ ok, label, detail });
  const icon = ok === true ? "✅" : ok === false ? "❌" : "⚠️";
  console.log(`${icon} ${label}${detail ? `：${detail}` : ""}`);
}

// 每个检查独立兜底：诊断环境往往本来就是坏的，单项抛错只记为该项失败
async function safely(label, fn) {
  try {
    await fn();
  } catch (error) {
    report(false, label, `检查本身出错：${error?.message || error}`);
  }
}

async function fetchWithTimeout(url, ms) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function checkApi() {
  const data = await (await fetchWithTimeout(`http://127.0.0.1:${API_PORT}/health`, 2000)).json();
  report(true, "守护进程（9344）", `运行中，pid ${data.pid}`);
}

async function checkCdp() {
  await fetchWithTimeout(`http://127.0.0.1:${CDP_PORT}/json/version`, 2000);
  report(true, "ZCode 调试端口（9343）", "开着");
  return true;
}

async function readStateFile() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function checkMainWindow() {
  const pages = classifyTargets(await listTargets(CDP_PORT, { timeoutMs: 2000 }));
  const { target, ambiguous } = pickMainWindow(pages);
  if (!target) {
    report(false, "ZCode 主窗口", "没找到。ZCode 可能还在启动中，稍等几秒再跑一次");
    return;
  }
  if (ambiguous) {
    report(false, "ZCode 主窗口", `有 ${pages.length} 个候选窗口，工具会挑第一个。建议关掉多余的 ZCode 窗口`);
    return;
  }
  report(true, "ZCode 主窗口", target.url);
}

async function checkSkin() {
  const state = await readStateFile();
  const pages = classifyTargets(await listTargets(CDP_PORT, { timeoutMs: 2000 }));
  const { target } = pickMainWindow(pages);
  if (!target) return; // 主窗口检查已报告过
  const { CdpSession } = await import("./lib/cdp.mjs");
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    const status = await session.evaluate(statusScript());
    report(
      status.skinActive,
      "皮肤注入",
      status.skinActive
        ? `主题 ${status.themeId} · CSS 变量 --color-sidebar = ${status.sidebarVar || "(空)"}`
        : "没在注入。若 state.json 里选了主题且常驻开着，守护进程 5 秒内会自动补上",
    );
    // 按钮不在只算警告不算异常：守护进程 5 秒内自动补，多数情况是刚刷新完还没巡检到
    report(status.panelActive ? true : "warn", "主题中心按钮", status.panelActive ? "在" : "不在（守护进程 5 秒内自动补）");
    // 阅读增强默认关闭：开关关着 = 正常；开着但页面没有才值得提醒（守护进程会补）
    const wantReading = state?.readingEnhance === true;
    if (wantReading && !status.readingActive) {
      report(false, "阅读增强", "开关开着但页面里没有（守护进程 5 秒内会自动补上）");
    } else {
      report(true, "阅读增强", status.readingActive ? "开着" : "关着");
    }
  } finally {
    session.close();
  }
}

async function checkState() {
  const data = await readStateFile();
  if (!data) {
    report(false, "state.json", "读不到或不是合法 JSON。守护进程会按默认状态处理；跑一次 use-skin.sh 重建");
    return;
  }
  report(true, "state.json", `当前主题 ${data.theme ?? "（官方外观）"} · 常驻 ${data.persistence} · 阅读 ${data.readingEnhance}`);
  if (data.theme) {
    try {
      await access(join(THEMES_ROOT, data.theme, "theme.json"));
      report(true, `主题目录 themes/${data.theme}`, "存在");
    } catch {
      report(false, `主题目录 themes/${data.theme}`, "被删了。用 use-skin.sh 换一个有效主题");
    }
  }
}

async function checkThemes() {
  const dirs = (await readdir(THEMES_ROOT, { withFileTypes: true })).filter((e) => e.isDirectory());
  report(true, "主题库", `${dirs.length} 个主题目录`);
}

console.log(`ZCode 皮肤工具体检\n`);
await safely("守护进程（9344）", checkApi);
let cdpOk = false;
await safely("ZCode 调试端口（9343）", async () => { cdpOk = await checkCdp(); });
if (cdpOk) {
  await safely("ZCode 主窗口", checkMainWindow);
  await safely("皮肤注入", checkSkin);
}
await safely("state.json", checkState);
await safely("主题库", checkThemes);

const bad = rows.filter((r) => r.ok === false).length;
console.log(`\n结论：${bad === 0 ? "全部正常 🎉" : `${bad} 项异常，按上面的修复指引处理`}`);
