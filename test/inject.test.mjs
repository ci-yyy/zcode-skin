// test/inject.test.mjs — 注入脚本的 DOM 未就绪行为
// 背景：ZCode 刚重启时窗口目标已出现在 /json/list 但文档还没解析
// （head/documentElement 均 null），旧版注入脚本直接
// `Cannot read properties of null (reading 'appendChild')`。v1.2.4 起返回
// { notReady: true } 让调用方重试。用 node:vm 在无 DOM 的裸环境里执行脚本验证。

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  healthScript,
  readingInjectionScript,
  skinInjectionScript,
  domReadyScript,
} from "../lib/inject.mjs";

// 在完全没挂 document 的沙箱里执行注入脚本（模拟 CDP 刚连上、文档未解析）
// 注意：跨 vm realm 的对象不能直接 deepEqual（原型链不同），统一 JSON 化再比
function evalNoDom(script) {
  const sandbox = {}; // 无 document、无 window
  return JSON.parse(JSON.stringify(vm.runInNewContext(script, sandbox)));
}

test("无 DOM 时 skinInjectionScript 返回 notReady 而不是抛错", () => {
  const result = evalNoDom(skinInjectionScript("body{color:red}", "test-theme"));
  assert.deepEqual(result, { applied: false, notReady: true });
});

test("无 DOM 时 readingInjectionScript 返回 notReady 而不是抛错", () => {
  const result = evalNoDom(readingInjectionScript("/* css */"));
  assert.deepEqual(result, { applied: false, notReady: true });
});

test("无 DOM 时 healthScript 返回 notReady 而不是抛错", () => {
  const result = evalNoDom(healthScript());
  assert.deepEqual(result, { notReady: true });
});

test("无 DOM 时 domReadyScript 返回 false", () => {
  assert.equal(evalNoDom(domReadyScript()), false);
});

// 最小 DOM 模拟：验证就绪路径依旧正常（结果同样 JSON 化，避开跨 realm 比较）
function evalWithDom(script, { existingStyle } = {}) {
  const styleRegistry = new Map();
  const fakeDoc = {
    head: { appendChild(el) { styleRegistry.set(el.id, el); } },
    documentElement: null,
    getElementById: (id) => styleRegistry.get(id),
    createElement: () => ({ id: "", textContent: "", setAttribute() {} }),
  };
  const sandbox = {
    document: fakeDoc,
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
  };
  if (existingStyle) styleRegistry.set(existingStyle.id, existingStyle);
  return {
    result: JSON.parse(JSON.stringify(vm.runInNewContext(script, sandbox))),
    styleRegistry,
  };
}

test("DOM 就绪时正常注入并返回 applied", () => {
  const { result, styleRegistry } = evalWithDom(skinInjectionScript("body{}", "t"));
  assert.equal(result.applied, true);
  assert.equal(result.notReady, undefined);
  assert.equal(styleRegistry.size, 1);
});

test("domReadyScript 在有 head 时返回 true", () => {
  const { result } = evalWithDom(domReadyScript());
  assert.equal(result, true);
});
