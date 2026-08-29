// test/cdp.test.mjs — classifyTargets / pickMainWindow 分类与 CdpSession 错误路径（假 WebSocket）
import { test } from "node:test";
import assert from "node:assert/strict";
import { CdpSession, classifyTargets, pickMainWindow, validatePort } from "../lib/cdp.mjs";

const MAIN_URL = "file:///Applications/ZCode.app/Contents/Resources/app.asar/out/renderer/index.html";
const PANEL_URL = "file:///Applications/ZCode.app/Contents/Resources/app.asar/out/renderer/cua-permission-panel.html";

test("validatePort 拒绝范围外端口", () => {
  assert.equal(validatePort(9343), 9343);
  assert.throws(() => validatePort(80));
  assert.throws(() => validatePort(70000));
  assert.throws(() => validatePort("9343"));
});

test("classifyTargets 只留 page 类型并分类", () => {
  const targets = [
    { type: "page", url: MAIN_URL, webSocketDebuggerUrl: "ws://a" },
    { type: "page", url: PANEL_URL, webSocketDebuggerUrl: "ws://b" },
    { type: "browser", url: "http://x" },
    { type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://c" },
  ];
  const pages = classifyTargets(targets);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.kind), ["main", "panel", "unknown"]);
});

test("classifyTargets 空输入/畸形输入不抛", () => {
  assert.deepEqual(classifyTargets([]), []);
  assert.deepEqual(classifyTargets(null), []);
  assert.deepEqual(classifyTargets([{ type: "page" }, { type: "page", url: 123 }]), [
    { type: "page", kind: "unknown" },
    { type: "page", url: 123, kind: "unknown" },
  ]);
});

test("pickMainWindow 优先精确主窗口", () => {
  const pages = classifyTargets([
    { type: "page", url: MAIN_URL, webSocketDebuggerUrl: "ws://a" },
    { type: "page", url: PANEL_URL, webSocketDebuggerUrl: "ws://b" },
  ]);
  const { target, ambiguous } = pickMainWindow(pages);
  assert.equal(target.webSocketDebuggerUrl, "ws://a");
  assert.equal(ambiguous, false);
});

test("pickMainWindow 多个主窗口标记歧义但可用", () => {
  const { target, ambiguous } = pickMainWindow(classifyTargets([
    { type: "page", url: MAIN_URL, webSocketDebuggerUrl: "ws://a" },
    { type: "page", url: MAIN_URL, webSocketDebuggerUrl: "ws://b" },
  ]));
  assert.ok(target);
  assert.equal(ambiguous, true);
});

test("pickMainWindow 无精确匹配时唯一的非弹窗页面可当选", () => {
  const { target, ambiguous } = pickMainWindow(classifyTargets([
    { type: "page", url: "file:///other.html", webSocketDebuggerUrl: "ws://c" },
    { type: "page", url: PANEL_URL, webSocketDebuggerUrl: "ws://b" },
  ]));
  assert.equal(target.webSocketDebuggerUrl, "ws://c");
  assert.equal(ambiguous, false);
});

test("pickMainWindow 无候选返回 null", () => {
  assert.equal(pickMainWindow(classifyTargets([])).target, null);
  assert.equal(pickMainWindow(classifyTargets([{ type: "page", url: PANEL_URL }])).target, null);
});

test("pickMainWindow 候选都无 WebSocket 时不认", () => {
  assert.equal(pickMainWindow(classifyTargets([{ type: "page", url: MAIN_URL }])).target, null);
});

// ---------- CdpSession 用假 WebSocket ----------
class FakeWebSocket {
  // CdpSession 用 WebSocket.OPEN 常量判断连接状态，假类上也要有
  static OPEN = 1;
  static CLOSED = 3;
  constructor() {
    this.listeners = {};
    this.sent = [];
    this.readyState = 0;
  }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, arg) { for (const fn of this.listeners[name] || []) fn({ data: arg }); }
  open() { this.readyState = 1; for (const fn of this.listeners.open || []) fn(); }
  error() { for (const fn of this.listeners.error || []) fn(); }
  close() {
    this.readyState = 3;
    for (const fn of this.listeners.close || []) fn();
  }
  send(raw) {
    this.sent.push(JSON.parse(raw));
    const msg = JSON.parse(raw);
    // 回显：按 id 应答，形状对齐 Runtime.evaluate 的 CDP 返回
    queueMicrotask(() => this.emit("message", JSON.stringify({
      id: msg.id,
      result: { result: { value: msg.method } },
    })));
  }
}

// 把全局 WebSocket 换成固定返回 ws 实例的工厂（保留 OPEN/CLOSED 常量）
function fakeWebSocketFactory(ws) {
  const factory = function () { return ws; };
  factory.OPEN = 1;
  factory.CLOSED = 3;
  return factory;
}

test("CdpSession open+evaluate 走通", async () => {
  const ws = new FakeWebSocket();
  const session = new CdpSession("ws://fake");
  // 偷天换日：open() 里 new WebSocket 的全局被替换
  const realWS = globalThis.WebSocket;
  globalThis.WebSocket = fakeWebSocketFactory(ws);
  try {
    const opened = session.open();
    ws.open();
    await opened;
    const value = await session.evaluate("1+1");
    assert.equal(value, "Runtime.evaluate"); // 假 ws 回显 method 名
    assert.ok(session.isOpen());
  } finally {
    globalThis.WebSocket = realWS;
  }
  session.close();
});

test("CdpSession 未打开时 send 直接拒绝", async () => {
  const session = new CdpSession("ws://fake");
  await assert.rejects(() => session.send("Runtime.evaluate"), /未打开/);
  assert.equal(session.isOpen(), false);
});

test("CdpSession 连接错误转为可读异常", async () => {
  const ws = new FakeWebSocket();
  const session = new CdpSession("ws://fake");
  const realWS = globalThis.WebSocket;
  globalThis.WebSocket = fakeWebSocketFactory(ws);
  try {
    const opened = session.open();
    const failing = assert.rejects(opened, /无法连接 CDP/);
    ws.error();
    await failing;
  } finally {
    globalThis.WebSocket = realWS;
  }
});

test("CdpSession 连接关闭拒绝挂起命令", async () => {
  const ws = new FakeWebSocket();
  const session = new CdpSession("ws://fake");
  const realWS = globalThis.WebSocket;
  globalThis.WebSocket = fakeWebSocketFactory(ws);
  try {
    const opened = session.open();
    ws.open();
    await opened;
    // send 但不回应（假 send 覆盖为不回显）
    ws.send = (raw) => { ws.sent.push(JSON.parse(raw)); };
    const pending = session.send("Runtime.evaluate");
    const rejecting = assert.rejects(pending, /CDP 连接已关闭/);
    ws.close();
    await rejecting;
  } finally {
    globalThis.WebSocket = realWS;
  }
});

test("CdpSession 命令超时拒绝", async () => {
  const ws = new FakeWebSocket();
  const session = new CdpSession("ws://fake", { commandTimeoutMs: 20 });
  const realWS = globalThis.WebSocket;
  globalThis.WebSocket = fakeWebSocketFactory(ws);
  try {
    const opened = session.open();
    ws.open();
    await opened;
    ws.send = () => {}; // 不应答
    await assert.rejects(() => session.send("Runtime.evaluate"), /CDP 命令超时/);
  } finally {
    globalThis.WebSocket = realWS;
  }
});

test("CdpSession evaluate 把 exceptionDetails 转成异常", async () => {
  const ws = new FakeWebSocket();
  const session = new CdpSession("ws://fake");
  const realWS = globalThis.WebSocket;
  globalThis.WebSocket = fakeWebSocketFactory(ws);
  try {
    const opened = session.open();
    ws.open();
    await opened;
    ws.send = (raw) => {
      const msg = JSON.parse(raw);
      queueMicrotask(() => ws.emit("message", JSON.stringify({
        id: msg.id,
        result: { result: { value: null }, exceptionDetails: { text: "页面炸了" } },
      })));
    };
    await assert.rejects(() => session.evaluate("boom()"), /页面内执行失败：页面炸了/);
  } finally {
    globalThis.WebSocket = realWS;
  }
});
