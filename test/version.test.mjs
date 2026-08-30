// test/version.test.mjs — 版本口径一致性：README 头条 / CHANGELOG / 启动器 bundle 必须与 package.json 同版
// 起因：连续两次发版只更新了 CHANGELOG 忘了 README 的「🆕 头条块」，靠测试拦住这类遗漏。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (name) => readFileSync(join(root, name), "utf8");

const version = JSON.parse(read("package.json")).version;

test(`README.md 头条块是当前版本 ${version}`, () => {
  assert.match(read("README.md"), new RegExp(`🆕 ${version.replace(/\./g, "\\.")} `),
    "README.md 顶部「🆕 更新」块还是旧版本——发版时忘了更新");
});

test(`README.en.md 头条块是当前版本 ${version}`, () => {
  assert.match(read("README.en.md"), new RegExp(`🆕 ${version.replace(/\./g, "\\.")}:`),
    "README.en.md 顶部「🆕」块还是旧版本——发版时忘了更新");
});

test(`CHANGELOG 有 ${version} 的小节`, () => {
  assert.match(read("CHANGELOG.md"), new RegExp(`^## ${version.replace(/\./g, "\\.")}（`, "m"),
    "CHANGELOG.md 缺当前版本的小节");
});

test("make-launcher.sh 的 bundle 版本与 package.json 一致", () => {
  const script = read("make-launcher.sh");
  const matches = [...script.matchAll(/CFBundle(?:ShortVersionString|Version)<\/key><string>([\d.]+)<\/string>/g)]
    .map((m) => m[1]);
  assert.ok(matches.length >= 2, "make-launcher.sh 里没找到 CFBundleVersion 键");
  for (const v of matches) {
    assert.equal(v, version, `make-launcher.sh 版本 ${v} 与 package.json ${version} 不一致`);
  }
});

test("README 中英文的测试用例数与实际一致", async () => {
  const { readdirSync } = await import("node:fs");
  let count = 0;
  for (const f of readdirSync(join(root, "test"))) {
    if (!f.endsWith(".test.mjs")) continue;
    count += (read(join("test", f)).match(/^test\(/gm) || []).length;
  }
  const zh = read("README.md");
  const en = read("README.en.md");
  const zhNums = [...zh.matchAll(/(\d+) 个用例/g)].map((m) => Number(m[1]));
  const enNums = [...en.matchAll(/(\d+) cases/g)].map((m) => Number(m[1]));
  for (const n of [...zhNums, ...enNums]) {
    assert.equal(n, count, `README 里的用例数 ${n} 与实际 ${count} 不符`);
  }
});
