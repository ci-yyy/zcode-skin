#!/usr/bin/env node
// apply.mjs — 把主题注入正在运行的 ZCode（前提：ZCode 带 --remote-debugging-port=9343 启动）
//
// 用法：
//   node apply.mjs                          注入默认主题
//   node apply.mjs --theme themes/default   指定主题目录
//   node apply.mjs --port 9343              指定 CDP 端口（默认 9343）
//   node apply.mjs --wait 60000             等主窗口出现的最长时间（毫秒）
//   node apply.mjs --dry-run                只打印生成的 CSS，不连接 ZCode
//   node apply.mjs --status                 查看当前皮肤状态
//   node apply.mjs --list                   列出所有可用主题

import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { STYLE_ID, buildSkinCss, loadTheme } from "./lib/theme.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    port: DEFAULT_PORT,
    theme: resolve(here, "themes/default"),
    waitMs: 15000,
    status: false,
    list: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") opts.port = Number(argv[++i]);
    else if (arg === "--theme") opts.theme = resolve(argv[++i]);
    else if (arg === "--wait") opts.waitMs = Number(argv[++i]);
    else if (arg === "--status") opts.status = true;
    else if (arg === "--list") opts.list = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!Number.isInteger(opts.port)) throw new Error("--port 需要一个整数");
  if (!Number.isInteger(opts.waitMs) || opts.waitMs < 0) throw new Error("--wait 需要一个非负整数（毫秒）");
  return opts;
}

async function listThemes() {
  const themesRoot = join(here, "themes");
  let entries;
  try {
    entries = (await readdir(themesRoot, { withFileTypes: true })).filter((e) => e.isDirectory());
  } catch {
    throw new Error(`找不到主题目录：${themesRoot}`);
  }
  console.log("可用主题（apply.mjs --theme themes/<名字>）：\n");
  for (const entry of entries) {
    try {
      const theme = await loadTheme(join(themesRoot, entry.name));
      const icon = theme.appearance === "light" ? "☀️" : "🌙";
      const bg = theme.heroImage ? "🖼 背景图" : theme.heroCss ? "🎨 渐变" : "";
      console.log(`  ${icon} ${entry.name.padEnd(24)} ${theme.name || ""}  ${bg}`);
    } catch {
      console.log(`  ⚠️  ${entry.name.padEnd(24)} （theme.json 无效，跳过）`);
    }
  }
}

async function waitForMainWindow(port, waitMs) {
  const deadline = Date.now() + waitMs;
  let lastPages = [];
  while (Date.now() < deadline) {
    try {
      lastPages = classifyTargets(await listTargets(port, { timeoutMs: 1500 }));
      const { target } = pickMainWindow(lastPages);
      if (target) return target;
    } catch {
      // 端口还没起来（ZCode 正在启动），继续等
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const seen = lastPages.length
    ? lastPages.map((p) => `  [${p.kind}] ${p.url}`).join("\n")
    : "  （没看到任何页面，可能端口没开或 ZCode 没启动）";
  throw new Error(`等不到 ZCode 主窗口（端口 ${port}）。看到的页面：\n${seen}`);
}

// 注入脚本：先删旧的同名 <style> 再插入新的（幂等，重复执行不会叠加）
function injectionScript(css, themeId) {
  return `(() => {
    try {
      const previous = document.getElementById(${JSON.stringify(STYLE_ID)});
      if (previous) previous.remove();
      const style = document.createElement("style");
      style.id = ${JSON.stringify(STYLE_ID)};
      style.setAttribute("data-zcode-skin", ${JSON.stringify(themeId)});
      style.textContent = ${JSON.stringify(css)};
      (document.head || document.documentElement).appendChild(style);
      const computed = getComputedStyle(document.documentElement);
      return {
        applied: true,
        bytes: style.textContent.length,
        sidebarVar: computed.getPropertyValue("--color-sidebar").trim(),
        backgroundVar: computed.getPropertyValue("--color-background").trim(),
      };
    } catch (error) {
      return { applied: false, error: String(error) };
    }
  })()`;
}

const STATUS_SCRIPT = `(() => {
  const style = document.getElementById(${JSON.stringify(STYLE_ID)});
  const computed = getComputedStyle(document.documentElement);
  return {
    skinActive: !!style,
    themeId: style ? style.getAttribute("data-zcode-skin") : null,
    sidebarVar: computed.getPropertyValue("--color-sidebar").trim(),
    backgroundVar: computed.getPropertyValue("--color-background").trim(),
    url: location.href,
  };
})()`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.list) {
    await listThemes();
    return;
  }

  if (opts.dryRun) {
    const theme = await loadTheme(opts.theme);
    console.log(await buildSkinCss(theme, opts.theme));
    return;
  }

  const target = await waitForMainWindow(opts.port, opts.waitMs);
  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    if (opts.status) {
      const status = await session.evaluate(STATUS_SCRIPT);
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    const theme = await loadTheme(opts.theme);
    const css = await buildSkinCss(theme, opts.theme);
    const result = await session.evaluate(injectionScript(css, theme.id));
    if (!result?.applied) throw new Error(`注入失败：${result?.error}`);

    console.log(`✅ 主题「${theme.name || theme.id}」已注入`);
    console.log(`   目标窗口：${target.url}`);
    console.log(`   CSS 大小：${result.bytes} 字节`);
    console.log(`   抽检 --color-sidebar = ${result.sidebarVar || "(空)"}`);
    console.log(`   抽检 --color-background = ${result.backgroundVar || "(空)"}`);
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
