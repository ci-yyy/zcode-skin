// lib/cdp.mjs — 极简 CDP 客户端（Chrome DevTools Protocol）
// 零依赖：Node 22+ 自带全局 fetch 和 WebSocket，直接可用。
// 安全边界：只连 127.0.0.1 本机回环，只对页面目标执行只读+注入操作。

export const DEFAULT_PORT = 9343;

export function validatePort(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new TypeError(`端口必须是 1024~65535 的整数，收到：${port}`);
  }
  return port;
}

export async function fetchJson(url, { timeoutMs = 3000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function listTargets(port, opts) {
  return fetchJson(`http://127.0.0.1:${validatePort(port)}/json/list`, opts);
}

// 页面目标分类：
//   main  = ZCode 主窗口（out/renderer/index.html）
//   panel = 电脑控制权限确认弹窗（cua-permission-panel.html，不注入）
//   unknown = 其他页面（如加载中、内部工具页）
export function classifyTargets(targets) {
  const pages = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    if (target?.type !== "page") continue;
    const url = typeof target.url === "string" ? target.url : "";
    const kind = url.includes("cua-permission-panel")
      ? "panel"
      : url.includes("out/renderer/index.html")
        ? "main"
        : "unknown";
    pages.push({ ...target, kind });
  }
  return pages;
}

// 挑出主窗口。找不到精确匹配时，若恰好只有一个非弹窗页面，也认它（容错 ZCode 改路径）。
export function pickMainWindow(pages) {
  const main = pages.filter((p) => p.kind === "main" && p.webSocketDebuggerUrl);
  if (main.length > 0) return { target: main[0], ambiguous: main.length > 1 };
  const usable = pages.filter((p) => p.kind !== "panel" && p.webSocketDebuggerUrl);
  if (usable.length === 1) return { target: usable[0], ambiguous: false };
  return { target: null, ambiguous: usable.length > 1 };
}

export class CdpSession {
  constructor(wsUrl, { connectTimeoutMs = 5000, commandTimeoutMs = 10000 } = {}) {
    this.wsUrl = wsUrl;
    this.connectTimeoutMs = connectTimeoutMs;
    this.commandTimeoutMs = commandTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.ws = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      if (typeof WebSocket !== "function") {
        reject(new Error("当前 Node 没有全局 WebSocket，请用 Node 22 或更新版本"));
        return;
      }
      let settled = false;
      const ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch {}
        reject(new Error(`连接 CDP 超时：${this.wsUrl}`));
      }, this.connectTimeoutMs);
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(message));
      };
      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        resolve(this);
      });
      ws.addEventListener("error", () => fail(`无法连接 CDP：${this.wsUrl}`));
      ws.addEventListener("close", () => {
        clearTimeout(timer);
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new Error("CDP 连接已关闭"));
        }
        this.pending.clear();
      });
      ws.addEventListener("message", (event) => {
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.id && this.pending.has(message.id)) {
          const { resolve: resolvePending, reject: rejectPending } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) rejectPending(new Error(message.error.message || "CDP 命令失败"));
          else resolvePending(message.result);
        }
      });
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("CDP 连接未打开"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 命令超时：${method}`));
      }, this.commandTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // 连接是否可用（daemon 缓存会话前先探测）
  isOpen() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "未知异常";
      throw new Error(`页面内执行失败：${detail.slice(0, 200)}`);
    }
    return result.result?.value;
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}
