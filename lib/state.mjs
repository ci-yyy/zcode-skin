// lib/state.mjs — 状态与设置（工具目录 state.json，所有入口共享）
//
// 字段：
//   theme          当前主题目录名；null = 官方外观（终端 use-skin.sh、主题中心面板、
//                  守护进程恢复都会写它）
//   persistence    皮肤常驻开关（默认 true）：开着 = ZCode 刷新/重启后守护进程自动
//                  恢复皮肤和主题中心；关掉 = 本次会话用完即止，下次启动原生界面
//   readingEnhance 阅读增强开关（默认 false）：给 AI 回复与思考块加半透明底色
//   miniButton     主题中心按钮收起为小圆点（默认 false）

import { access, readFile, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "state.json");

const DEFAULTS = {
  theme: null,
  persistence: true,
  readingEnhance: false,
  miniButton: false,
};

const SETTING_KEYS = ["persistence", "readingEnhance", "miniButton"];

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
    const state = { ...DEFAULTS };
    if (typeof data.theme === "string") state.theme = data.theme;
    else if (data.theme === null) state.theme = null;
    for (const key of SETTING_KEYS) {
      if (typeof data[key] === "boolean") state[key] = data[key];
    }
    return state;
  } catch {
    return { ...DEFAULTS };
  }
}

// 增量更新：只写传入的字段，其余保持不变
export async function updateState(patch) {
  if (patch === undefined || patch === null) throw new TypeError("updateState 需要一个 patch 对象");
  const next = { ...DEFAULTS };
  const cur = await readState();
  Object.assign(next, cur);
  if ("theme" in patch) {
    if (patch.theme !== null && typeof patch.theme !== "string") {
      throw new TypeError(`theme 必须是目录名字符串或 null，收到：${patch.theme}`);
    }
    next.theme = patch.theme;
  }
  for (const key of SETTING_KEYS) {
    if (key in patch) {
      if (typeof patch[key] !== "boolean") {
        throw new TypeError(`${key} 必须是布尔值，收到：${patch[key]}`);
      }
      next[key] = patch[key];
    }
  }
  // 原子写：先写临时文件再改名。终端、面板、守护进程都会写这个文件，
  // 直接覆写在中断时会留下半个 JSON，守护进程读到坏文件会静默退回默认状态
  const tmpFile = `${STATE_FILE}.tmp`;
  await writeFile(tmpFile, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }, null, 2) + "\n", "utf8");
  await rename(tmpFile, STATE_FILE);
  return next;
}
