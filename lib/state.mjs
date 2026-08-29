// lib/state.mjs — 状态与设置（工具目录 state.json，所有入口共享）
//
// 字段：
//   theme          当前主题目录名；null = 官方外观（终端 use-skin.sh、主题中心面板、
//                  守护进程恢复都会写它）
//   persistence    皮肤常驻开关（默认 true）：开着 = ZCode 刷新/重启后守护进程自动
//                  恢复皮肤和主题中心；关掉 = 本次会话用完即止，下次启动原生界面
//   readingEnhance 阅读增强开关（默认 false）：给 AI 回复与思考块加半透明底色
//   miniButton     主题中心按钮收起为小圆点（默认 false）
//   schemaVersion  状态文件结构版本（当前 1）；读到不认识的版本时按默认状态处理并告警，
//                  给将来的结构迁移留安全出口
//
// 并发：终端、面板、守护进程会同时写这个文件。写入走「文件锁 + 读改写 + 临时文件改名」：
// 锁防止两个进程的读改写交错丢 patch，原子改名防止中断留下半个 JSON。

import { access, open, readFile, rename, stat, unlink, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 测试可用 ZCODE_SKIN_STATE_DIR 把状态指到临时目录
const STATE_DIR = process.env.ZCODE_SKIN_STATE_DIR
  ? resolve(process.env.ZCODE_SKIN_STATE_DIR)
  : join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_FILE = join(STATE_DIR, "state.json");
const LOCK_FILE = join(STATE_DIR, ".state.lock");

const SCHEMA_VERSION = 1;
const LOCK_STALE_MS = 10_000; // 锁龄超过 10 秒视为陈旧（持有进程卡死/崩溃遗留）
const LOCK_WAIT_MS = 5_000;   // 最多等锁 5 秒，超时抛错而不是永久卡死

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

let warnedUnknownSchema = false;

export async function readState() {
  let data;
  try {
    data = JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { ...DEFAULTS };
  }
  if (data.schemaVersion !== undefined && data.schemaVersion !== SCHEMA_VERSION) {
    if (!warnedUnknownSchema) {
      warnedUnknownSchema = true;
      console.error(
        `[state] state.json 的 schemaVersion=${data.schemaVersion} 不被当前版本支持`
        + `（支持 ${SCHEMA_VERSION}），已按默认状态处理；写一次新状态会覆盖旧内容`,
      );
    }
    return { ...DEFAULTS };
  }
  const state = { ...DEFAULTS };
  if (typeof data.theme === "string") state.theme = data.theme;
  else if (data.theme === null) state.theme = null;
  for (const key of SETTING_KEYS) {
    if (typeof data[key] === "boolean") state[key] = data[key];
  }
  return state;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// pid 是否还活着。EPERM = 进程存在但不归我们管，也算活着。
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// 锁文件内容读不出（半个 JSON 等）时退回按文件年龄判断
async function lockIsStale() {
  let content;
  try {
    content = await readFile(LOCK_FILE, "utf8");
  } catch {
    return true; // 锁刚好被别人释放了
  }
  try {
    const info = JSON.parse(content);
    const age = Date.now() - (Number(info.startedAt) || 0);
    if (age > LOCK_STALE_MS) return true;
    if (Number.isInteger(info.pid) && !processAlive(info.pid)) return true;
    return false;
  } catch {
    try {
      return Date.now() - (await stat(LOCK_FILE)).mtimeMs > LOCK_STALE_MS;
    } catch {
      return true;
    }
  }
}

async function acquireLock() {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(LOCK_FILE, "wx");
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }) + "\n", "utf8");
      } finally {
        await handle.close();
      }
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (await lockIsStale()) {
        // 陈旧锁：清掉重试。unlink 前内容再核对一次，尽量不误删别人刚拿到的新锁
        const before = await readFile(LOCK_FILE, "utf8").catch(() => null);
        if (before === null) continue;
        const after = await readFile(LOCK_FILE, "utf8").catch(() => null);
        if (after === before) {
          try { await unlink(LOCK_FILE); } catch {}
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("state.json 写入锁等待超时（另一进程持有 .state.lock 超过 5 秒）");
      }
      // 短轮询 + 随机抖动：写者多时不至于集体同拍抢锁
      await sleep(10 + Math.floor(Math.random() * 15));
    }
  }
}

async function releaseLock() {
  try { await unlink(LOCK_FILE); } catch {}
}

// 增量更新：只写传入的字段，其余保持不变
export async function updateState(patch) {
  if (patch === undefined || patch === null || typeof patch !== "object") {
    throw new TypeError("updateState 需要一个 patch 对象");
  }
  // 先校验再拿锁：坏输入直接抛，不占锁
  if ("theme" in patch && patch.theme !== null && typeof patch.theme !== "string") {
    throw new TypeError(`theme 必须是目录名字符串或 null，收到：${patch.theme}`);
  }
  for (const key of SETTING_KEYS) {
    if (key in patch && typeof patch[key] !== "boolean") {
      throw new TypeError(`${key} 必须是布尔值，收到：${patch[key]}`);
    }
  }
  await mkdir(STATE_DIR, { recursive: true });
  await acquireLock();
  try {
    // 读放在锁内：拿到的才是别人提交完的最新状态，读改写才不会互相覆盖
    const next = await readState();
    if ("theme" in patch) next.theme = patch.theme;
    for (const key of SETTING_KEYS) {
      if (key in patch) next[key] = patch[key];
    }
    // 临时文件名带 pid + 随机串：多进程同时写时不会互相覆盖临时文件
    const tmpFile = join(STATE_DIR, `state.json.${process.pid}.${randomUUID().slice(0, 8)}.tmp`);
    await writeFile(tmpFile, JSON.stringify(
      { schemaVersion: SCHEMA_VERSION, ...next, updatedAt: new Date().toISOString() },
      null,
      2,
    ) + "\n", "utf8");
    await rename(tmpFile, STATE_FILE);
    return next;
  } finally {
    await releaseLock();
  }
}
