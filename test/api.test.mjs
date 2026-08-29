// test/api.test.mjs — createRequestHandler 路由：Origin 校验、目录穿越、体积上限、状态码
// 用假 req/res 直调 handler，不真开端口。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createRequestHandler } from "../daemon.mjs";

function fakeReq({ method = "GET", url = "/", headers = {}, body = null }) {
  const req = new Readable({ read() {} });
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { localPort: 9344 };
  if (body) for (const chunk of body) req.push(chunk);
  req.push(null);
  return req;
}

function fakeRes() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  // 对齐 Node 真实行为：头名一律小写
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = {};
    for (const [k, v] of Object.entries(headers)) res.headers[k.toLowerCase()] = v;
  };
  res.end = (payload) => {
    res.writableEnded = true;
    res.body = payload ? JSON.parse(payload) : "";
    res.emit("done");
  };
  return res;
}

async function call(handler, { method, url, headers, body }) {
  const req = fakeReq({ method, url, headers, body });
  const res = fakeRes();
  const done = new Promise((resolve) => res.once("done", resolve));
  await handler(req, res);
  await done;
  return res;
}

function defaultDeps(overrides = {}) {
  return {
    listThemes: async () => [{ dir: "default", name: "默认", appearance: "dark" }],
    buildCss: async (dir) => ({ theme: { id: dir }, css: `/* css for ${dir} */` }),
    withMainWindow: async (fn) => fn({ evaluate: async () => ({ applied: true }) }),
    readState: async () => ({ theme: null, persistence: true, readingEnhance: false, miniButton: false }),
    updateState: async (patch) => patch,
    createThemeFromImage: async () => ({ dir: "new", name: "n", appearance: "dark" }),
    log: () => {},
    maxCssBytes: 16 * 1024 * 1024,
    maxUploadBytes: 12 * 1024 * 1024,
    themesRoot: "/tmp/zcsk-test-themes",
    ...overrides,
  };
}

test("GET /themes 返回列表与设置", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/themes" });
  assert.equal(res.status, 200);
  assert.equal(res.body.themes.length, 1);
  assert.equal(res.body.settings.persistence, true);
});

test("无 Origin 头（curl/Node）放行", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/themes", headers: {} });
  assert.equal(res.status, 200);
});

test("Origin: null（ZCode file:// 面板）放行", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/themes", headers: { origin: "null" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], "null");
});

test("file:// Origin 放行", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/themes", headers: { origin: "file://" } });
  assert.equal(res.status, 200);
});

test("https Origin 被拒 403", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "GET", url: "/themes", headers: { origin: "https://evil.example.com" },
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
  // 拒绝的响应不带 CORS 头（浏览器不会把响应暴露给恶意页面）
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("http Origin 被拒 403", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "POST", url: "/applied/default", headers: { origin: "http://localhost:3000" },
  });
  assert.equal(res.status, 403);
});

test("恶意页面的 OPTIONS 预检也被拒", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "OPTIONS", url: "/themes", headers: { origin: "https://evil.example.com" },
  });
  assert.equal(res.status, 403);
});

test("OPTIONS 预检对合法来源返回 204", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "OPTIONS", url: "/themes", headers: { origin: "null" } });
  assert.equal(res.status, 204);
});

test("GET /css/<dir> 返回 CSS", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/css/default" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.css, "/* css for default */");
});

test("目录穿越 ..%2f 被拒 400", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/css/..%2f..%2fetc" });
  assert.equal(res.status, 400);
});

test("目录穿越 %2e%2e%2f 被拒 400", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/css/%2e%2e%2fsecret" });
  assert.equal(res.status, 400);
});

test("反斜杠目录名被拒 400", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/css/a%5cb" });
  assert.equal(res.status, 400);
});

test("控制字符目录名被拒 400", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/css/a%01b" });
  assert.equal(res.status, 400);
});

test("畸形百分号转义返回 400 而不是 500", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/css/%zz" });
  assert.equal(res.status, 400);
});

test("CSS 超过上限返回 413", async () => {
  const handler = createRequestHandler(defaultDeps({
    buildCss: async (dir) => ({ theme: { id: dir }, css: "x".repeat(17 * 1024 * 1024) }),
  }));
  const res = await call(handler, { method: "GET", url: "/css/huge" });
  assert.equal(res.status, 413);
  assert.match(res.body.error, /主题过大/);
});

test("POST /applied/<dir> 写状态", async () => {
  const written = [];
  const handler = createRequestHandler(defaultDeps({
    updateState: async (patch) => { written.push(patch); return patch; },
  }));
  const res = await call(handler, { method: "POST", url: "/applied/default" });
  assert.equal(res.status, 200);
  assert.deepEqual(written, [{ theme: "default" }]);
});

test("POST /applied/<不存在的主题> 拒绝写入 state.json", async () => {
  const written = [];
  const handler = createRequestHandler(defaultDeps({
    updateState: async (patch) => { written.push(patch); return patch; },
  }));
  const res = await call(handler, { method: "POST", url: "/applied/does-not-exist" });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /主题不存在/);
  assert.deepEqual(written, [], "不存在的目录不能写进 state.json（守护进程会反复恢复失败）");
});

test("POST /applied/none 清空主题", async () => {
  const written = [];
  const handler = createRequestHandler(defaultDeps({
    updateState: async (patch) => { written.push(patch); return patch; },
  }));
  const res = await call(handler, { method: "POST", url: "/applied/none" });
  assert.equal(res.status, 200);
  assert.deepEqual(written, [{ theme: null }]);
});

test("POST /applied/ 目录穿越被拒", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "POST", url: "/applied/..%2fetc" });
  assert.equal(res.status, 400);
});

test("POST /settings/<key> 校验 value 类型", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "POST",
    url: "/settings/persistence",
    headers: { "content-type": "application/json" },
    body: [Buffer.from(JSON.stringify({ value: "yes" }))],
  });
  assert.equal(res.status, 400);
});

test("POST /settings/<key> 非法 JSON 返回 400 而不是 500", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "POST",
    url: "/settings/persistence",
    headers: { "content-type": "application/json" },
    body: [Buffer.from("{not json")],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /合法 JSON/);
});

test("POST /settings/<key> body 是 JSON 字符串而非对象时 400", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "POST",
    url: "/settings/persistence",
    headers: { "content-type": "application/json" },
    body: [Buffer.from(JSON.stringify("true"))],
  });
  assert.equal(res.status, 400);
});

test("GET /applied/<dir> 不再改状态（只收 POST）", async () => {
  const written = [];
  const handler = createRequestHandler(defaultDeps({
    updateState: async (patch) => { written.push(patch); return patch; },
  }));
  const res = await call(handler, { method: "GET", url: "/applied/cyber-neon" });
  assert.equal(res.status, 404);
  assert.deepEqual(written, []);
});

test("POST /settings/<key> 正常写入", async () => {
  const written = [];
  const handler = createRequestHandler(defaultDeps({
    updateState: async (patch) => { written.push(patch); return { persistence: false, readingEnhance: false, miniButton: false }; },
  }));
  const res = await call(handler, {
    method: "POST",
    url: "/settings/persistence",
    headers: { "content-type": "application/json" },
    body: [Buffer.from(JSON.stringify({ value: false }))],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(written, [{ persistence: false }]);
  assert.equal(res.body.state.persistence, false);
});

test("POST /settings/ 未知键 404", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "POST", url: "/settings/whatever",
    headers: { "content-type": "application/json" },
    body: [Buffer.from(JSON.stringify({ value: true }))],
  });
  assert.equal(res.status, 404);
});

test("GET /random 随机切换并写状态", async () => {
  const written = [];
  const handler = createRequestHandler(defaultDeps({
    updateState: async (patch) => { written.push(patch); return patch; },
  }));
  const res = await call(handler, { method: "GET", url: "/random" });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(written, [{ theme: "default" }]);
});

test("GET /random 没有主题时 404", async () => {
  const handler = createRequestHandler(defaultDeps({ listThemes: async () => [] }));
  const res = await call(handler, { method: "GET", url: "/random" });
  assert.equal(res.status, 404);
});

test("GET /health 返回 pid", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/health" });
  assert.equal(res.status, 200);
  assert.equal(res.body.pid, process.pid);
});

test("未知路由 404", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, { method: "GET", url: "/nope" });
  assert.equal(res.status, 404);
});

test("handler 异常转 500 且不崩", async () => {
  const handler = createRequestHandler(defaultDeps({
    listThemes: async () => { throw new Error("炸了"); },
  }));
  const res = await call(handler, { method: "GET", url: "/themes" });
  assert.equal(res.status, 500);
  assert.match(res.body.error, /炸了/);
});

test("上传体积超限返回 4xx 且不写 500", async () => {
  const handler = createRequestHandler(defaultDeps({
    maxUploadBytes: 10,
  }));
  const boundary = "----boundary";
  const big = Buffer.alloc(64 * 1024, 0x61);
  const parts = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    big,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  // readBody 超限会 req.destroy()；假 req 没有 destroy，补一个
  const req = fakeReq({
    method: "POST",
    url: "/upload-theme",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: parts,
  });
  req.destroy = () => { req.destroyed = true; req.emit("error", Object.assign(new Error("aborted"), { code: "ECONNRESET" })); };
  const res = fakeRes();
  await handler(req, res);
  assert.ok(!res.writableEnded || res.status === undefined || res.status >= 400,
    `超限响应不该是 2xx，得到 ${res.status}`);
});

test("multipart 上传非图片后缀被拒", async () => {
  const handler = createRequestHandler(defaultDeps());
  const boundary = "----boundary";
  const body = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.gif"\r\n\r\nGIF89a\r\n--${boundary}--\r\n`,
  );
  const res = await call(handler, {
    method: "POST",
    url: "/upload-theme",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: [body],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /PNG\/JPG\/WebP/);
});

test("非 multipart 上传被拒", async () => {
  const handler = createRequestHandler(defaultDeps());
  const res = await call(handler, {
    method: "POST",
    url: "/upload-theme",
    headers: { "content-type": "application/json" },
    body: [Buffer.from("{}")],
  });
  assert.equal(res.status, 400);
});

test("合法上传走 createThemeFromImage", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "zcsk-api-"));
  await mkdir(join(tmpRoot, "logs"), { recursive: true });
  try {
    const created = [];
    const handler = createRequestHandler(defaultDeps({
      themesRoot: join(tmpRoot, "themes"),
      createThemeFromImage: async (args) => {
        created.push(args);
        return { dir: "new-theme", name: "新主题", appearance: "dark" };
      },
    }));
    const boundary = "----boundary";
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n我的主题\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pic.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await call(handler, {
      method: "POST",
      url: "/upload-theme",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: [body],
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.dir, "new-theme");
    assert.equal(created.length, 1);
    assert.equal(created[0].name, "我的主题");
    assert.equal(created[0].appearance, "auto");
    assert.equal(created[0].force, true);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("上传成功后临时文件被清理", async () => {
  const tmpRoot = await mkdtemp(join(tmpdir(), "zcsk-api2-"));
  await mkdir(join(tmpRoot, "logs"), { recursive: true });
  try {
    const { readdir } = await import("node:fs/promises");
    const handler = createRequestHandler(defaultDeps({
      themesRoot: join(tmpRoot, "themes"),
      createThemeFromImage: async () => ({ dir: "n", name: "n", appearance: "dark" }),
    }));
    const boundary = "----boundary";
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\n\r\n`),
      Buffer.from("89504e470d0a1a0a", "hex"),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    await call(handler, {
      method: "POST",
      url: "/upload-theme",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: [body],
    });
    const leftovers = (await readdir(join(tmpRoot, "logs"))).filter((f) => f.startsWith("upload-"));
    assert.deepEqual(leftovers, [], `临时文件残留：${leftovers}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});
