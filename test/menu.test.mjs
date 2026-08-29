// test/menu.test.mjs — matchThemes 归一化匹配
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchThemes } from "../lib/menu.mjs";

const themes = [
  { dir: "genshin-dawn", name: "原神·晨曦" },
  { dir: "deepspace-dawn", name: "恋与深空 · 晨曦" },
  { dir: "cyber-neon", name: "赛博霓虹" },
  { dir: "sakura-mist", name: "樱雾" },
];

test("目录名精确匹配", () => {
  const matches = matchThemes(themes, "cyber-neon");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].dir, "cyber-neon");
});

test("目录名子串匹配优先于名字匹配", () => {
  const matches = matchThemes(themes, "dawn");
  // genshin-dawn 和 deepspace-dawn 目录名都含 dawn
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((m) => m.dir).sort(), ["deepspace-dawn", "genshin-dawn"]);
});

test("中文名匹配（含中点）", () => {
  const matches = matchThemes(themes, "原神·晨曦");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].dir, "genshin-dawn");
});

test("中文名匹配（中点换成空格）", () => {
  const matches = matchThemes(themes, "原神 晨曦");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].dir, "genshin-dawn");
});

test("归一化：去掉全部空格和中点也能匹配", () => {
  for (const query of ["原神晨曦", "原神·晨曦", "原神 · 晨曦", "原神・晨曦"]) {
    const matches = matchThemes(themes, query);
    assert.equal(matches.length, 1, `查询「${query}」应只匹配原神·晨曦`);
    assert.equal(matches[0].dir, "genshin-dawn");
  }
});

test("名字子串匹配多结果", () => {
  const matches = matchThemes(themes, "晨曦");
  // 名字带「晨曦」的有两个；目录名都不含
  assert.equal(matches.length, 2);
});

test("英文名不区分大小写", () => {
  const list = [{ dir: "x", name: "Cyber Neon" }];
  assert.equal(matchThemes(list, "cyber").length, 1);
  assert.equal(matchThemes(list, "CYBER").length, 1);
});

test("无匹配返回空数组", () => {
  assert.deepEqual(matchThemes(themes, "不存在的主题"), []);
});

test("空查询在目录名分支下会全量返回（交互层由调用方兜底）", () => {
  // dir.includes("") 恒为 true，空字符串会全匹配；menu.mjs 交互里空输入提前退出不会走到这
  assert.equal(matchThemes(themes, "").length, themes.length);
});
