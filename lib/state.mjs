// lib/state.mjs — 记住「当前用的是哪套主题」
// 状态存在工具目录的 state.json，所有入口共享：
//   apply.mjs / restore.mjs（终端切换）、daemon.mjs（主题中心面板切换）都会写，
//   守护进程读它来决定 ZCode 启动后要恢复哪套皮肤。
// theme 字段 = 主题目录名；null = 官方外观。

import { access, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "state.json");

export async function stateFileExists() {
  try {
    await access(STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

export async function readState() {
  try {
    const data = JSON.parse(await readFile(STATE_FILE, "utf8"));
    return { theme: typeof data.theme === "string" ? data.theme : null };
  } catch {
    return { theme: null };
  }
}

export async function writeState(theme) {
  if (theme !== null && typeof theme !== "string") {
    throw new TypeError(`theme 必须是目录名字符串或 null，收到：${theme}`);
  }
  await writeFile(
    STATE_FILE,
    JSON.stringify({ theme, updatedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}
