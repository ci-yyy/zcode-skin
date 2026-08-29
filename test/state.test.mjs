// test/state.test.mjs — state.json 读写、原子性、并发与锁回收
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, updateState } from "../lib/state.mjs";

let dir;
let prevStateEnv;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zcsk-state-"));
  prevStateEnv = process.env.ZCODE_SKIN_STATE_DIR;
  process.env.ZCODE_SKIN_STATE_DIR = dir;
  // state.mjs 在模块加载时定死路径，每个用例用动态 import 拿到指向新目录的实例
});

afterEach(async () => {
  if (prevStateEnv === undefined) delete process.env.ZCODE_SKIN_STATE_DIR;
  else process.env.ZCODE_SKIN_STATE_DIR = prevStateEnv;
  await rm(dir, { recursive: true, force: true });
});

async function freshState() {
  const mod = await import(`../lib/state.mjs?dir=${encodeURIComponent(dir)}&t=${Date.now()}${Math.random()}`);
  return mod;
}

test("readState 无文件时返回默认值", async () => {
  const { readState: read } = await freshState();
  assert.deepEqual(await read(), { theme: null, persistence: true, readingEnhance: false, miniButton: false });
});

test("updateState 增量更新只动传入字段", async () => {
  const { updateState: update, readState: read } = await freshState();
  await update({ theme: "cyber-neon" });
  await update({ readingEnhance: true });
  const state = await read();
  assert.equal(state.theme, "cyber-neon");
  assert.equal(state.readingEnhance, true);
  assert.equal(state.persistence, true); // 没传的保持默认
});

test("updateState theme 可以显式清成 null", async () => {
  const { updateState: update, readState: read } = await freshState();
  await update({ theme: "default" });
  await update({ theme: null });
  assert.equal((await read()).theme, null);
});

test("updateState 拒绝非法 patch", async () => {
  const { updateState: update } = await freshState();
  await assert.rejects(() => update({ theme: 123 }), TypeError);
  await assert.rejects(() => update({ persistence: "yes" }), TypeError);
  await assert.rejects(() => update(undefined), TypeError);
});

test("写入带 schemaVersion 且 JSON 完整", async () => {
  const { updateState: update } = await freshState();
  await update({ theme: "default" });
  const raw = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(raw.schemaVersion, 1);
  assert.equal(raw.theme, "default");
  assert.ok(raw.updatedAt);
});

test("读到未知 schemaVersion 回退默认并告警", async () => {
  await writeFile(join(dir, "state.json"), JSON.stringify({ schemaVersion: 99, theme: "x" }), "utf8");
  const { readState: read } = await freshState();
  const state = await read();
  assert.equal(state.theme, null);
  assert.equal(state.persistence, true);
});

test("旧格式（无 schemaVersion）正常读取", async () => {
  await writeFile(join(dir, "state.json"), JSON.stringify({ theme: "old", persistence: false }), "utf8");
  const { readState: read } = await freshState();
  const state = await read();
  assert.equal(state.theme, "old");
  assert.equal(state.persistence, false);
});

test("坏 JSON 回退默认", async () => {
  await writeFile(join(dir, "state.json"), "{oops", "utf8");
  const { readState: read } = await freshState();
  assert.equal((await read()).theme, null);
});

test("并发 50 次 updateState 不丢字段不坏文件", async () => {
  const { updateState: update, readState: read } = await freshState();
  await update({ theme: "default" });
  const jobs = [];
  for (let i = 0; i < 25; i++) {
    jobs.push(update({ persistence: i % 2 === 0 }));
    jobs.push(update({ readingEnhance: i % 2 === 1 }));
  }
  await Promise.all(jobs);
  const final = await read();
  // 两类字段都写入过多次，最终值二选一都合法，关键是文件没坏、字段还在
  assert.equal(typeof final.persistence, "boolean");
  assert.equal(typeof final.readingEnhance, "boolean");
  assert.equal(final.theme, "default"); // 并发改其他字段时 theme 不能丢
  JSON.parse(await readFile(join(dir, "state.json"), "utf8")); // 不抛 = 没写坏
});

test("并发交替改 theme 与设置，最终状态一致可读", async () => {
  const { updateState: update, readState: read } = await freshState();
  const jobs = [];
  for (let i = 0; i < 20; i++) {
    jobs.push(update({ theme: i % 2 === 0 ? "a" : "b" }));
    jobs.push(update({ miniButton: true }));
  }
  await Promise.all(jobs);
  const final = await read();
  assert.ok(final.theme === "a" || final.theme === "b");
  assert.equal(final.miniButton, true);
});

test("陈旧锁（死进程持有）被回收", async () => {
  // 模拟一个已死进程留下的锁
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, ".state.lock"), JSON.stringify({ pid: 99999999, startedAt: Date.now() }), "utf8");
  const { updateState: update } = await freshState();
  // pid 99999999 不存在 → 判陈旧 → 清掉 → 正常写入
  await update({ theme: "default" });
  const raw = JSON.parse(await readFile(join(dir, "state.json"), "utf8"));
  assert.equal(raw.theme, "default");
});

test("锁用完释放，不留残留", async () => {
  const { updateState: update } = await freshState();
  await update({ theme: "default" });
  await assert.rejects(() => readFile(join(dir, ".state.lock")));
});

test("目录不存在时 updateState 自动创建", async () => {
  const nested = join(dir, "a/b/c");
  process.env.ZCODE_SKIN_STATE_DIR = nested;
  const mod = await import(`../lib/state.mjs?nested=${encodeURIComponent(nested)}&t=${Date.now()}`);
  await mod.updateState({ theme: "default" });
  const raw = JSON.parse(await readFile(join(nested, "state.json"), "utf8"));
  assert.equal(raw.theme, "default");
  process.env.ZCODE_SKIN_STATE_DIR = dir;
});
