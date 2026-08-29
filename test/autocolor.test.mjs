// test/autocolor.test.mjs — slugify / imageMime / createThemeFromImage 的 Node 侧逻辑
// 取色脚本本身要跑在 ZCode 渲染进程里（canvas），这里只测纯函数与文件流程。
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createThemeFromImage, imageMime, slugify, extractPaletteScript } from "../lib/autocolor.mjs";

let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zcsk-auto-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("slugify 中英文与符号", () => {
  assert.equal(slugify("Hello World"), "hello-world");
  assert.equal(slugify("原神·晨曦"), null); // 中文全被剥掉
  assert.equal(slugify("My Theme 2!"), "my-theme-2");
  assert.equal(slugify("---"), null);
});

test("imageMime 按后缀", () => {
  assert.equal(imageMime("a.png"), "image/png");
  assert.equal(imageMime("a.JPG"), "image/jpeg");
  assert.equal(imageMime("a.webp"), "image/webp");
  assert.equal(imageMime("a.gif"), null);
});

test("extractPaletteScript 包含 dataUrl 且语法合法（去壳后可解析）", () => {
  const script = extractPaletteScript("data:image/png;base64,AAAA");
  assert.ok(script.includes("data:image/png;base64,AAAA"));
  // 剥掉外层 async 箭头函数体做语法检查
  const body = script.replace(/^\(async \(\) => \{/, "").replace(/\}\)\(\)$/, "");
  new Function(`async () => { ${body.replace(/^return \{ ok: true[\s\S]*?\};$/m, "")} }`); // 不抛即可
});

test("extractPaletteScript 只内嵌 dataUrl 一次（长度判断用 img.src）", () => {
  const script = extractPaletteScript("data:image/png;base64,AAAA");
  const count = script.split("data:image/png;base64,AAAA").length - 1;
  assert.equal(count, 1, `dataUrl 被内嵌了 ${count} 次（应只有 img.src 一处）`);
  assert.ok(script.includes("img.src.length > 2 * 1024 * 1024"), "长度判断应引用 img.src 而不是再嵌一份");
});

test("createThemeFromImage 不存在的图片报错", async () => {
  await assert.rejects(
    () => createThemeFromImage({ session: null, imagePath: join(dir, "nope.png"), themesRoot: dir }),
    /图片不存在/,
  );
});

test("createThemeFromImage 不支持的后缀报错", async () => {
  const file = join(dir, "x.gif");
  await writeFile(file, "GIF89a");
  await assert.rejects(
    () => createThemeFromImage({ session: null, imagePath: file, themesRoot: dir }),
    /PNG \/ JPG \/ WebP/,
  );
});

test("createThemeFromImage 非法 appearance 报错", async () => {
  const file = join(dir, "x.png");
  await writeFile(file, Buffer.from("89504e470d0a1a0a", "hex"));
  await assert.rejects(
    () => createThemeFromImage({ session: null, imagePath: file, appearance: "blue", themesRoot: dir }),
    /appearance/,
  );
});

// 假 session：取色返回固定值；hero 不降采样（走原样拷贝分支）
function fakeSession(result) {
  return { evaluate: async () => result };
}

test("createThemeFromImage 生成主题目录与 theme.json", async () => {
  const file = join(dir, "src.png");
  await writeFile(file, Buffer.from("89504e470d0a1a0a", "hex"));
  const themesRoot = join(dir, "themes");
  const result = await createThemeFromImage({
    session: fakeSession({ ok: true, accent: "#38bdf8", secondary: "#818cf8", avg: "#202020", avgL: 0.2 }),
    imagePath: file,
    name: "我的主题",
    themesRoot,
  });
  assert.equal(result.appearance, "dark"); // avgL 0.2 < 0.45 → 深色
  const theme = JSON.parse(await readFile(join(themesRoot, result.dir, "theme.json"), "utf8"));
  assert.equal(theme.id, result.dir);
  assert.equal(theme.heroImage, "hero.png");
  assert.equal(theme.schemaVersion, 1);
  assert.ok(theme.colors.background); // buildColors 已填全变量
});

test("createThemeFromImage 中文名转不出 slug 时用内容哈希", async () => {
  const file = join(dir, "中文名.png");
  await writeFile(file, Buffer.from("89504e470d0a1a0a", "hex"));
  const result = await createThemeFromImage({
    session: fakeSession({ ok: true, accent: "#38bdf8", secondary: "#38bdf8", avg: "#f0f0f0", avgL: 0.9 }),
    imagePath: file,
    themesRoot: join(dir, "themes"),
  });
  assert.match(result.dir, /^custom-[0-9a-f]{8}$/);
  assert.equal(result.appearance, "light"); // avgL 0.9 ≥ 0.45 → 浅色
});

test("createThemeFromImage 降采样图被写入（hero.dataUrl 分支）", async () => {
  const file = join(dir, "big.png");
  await writeFile(file, Buffer.from("89504e470d0a1a0a", "hex"));
  const themesRoot = join(dir, "themes");
  // 1x1 PNG 的 base64
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const result = await createThemeFromImage({
    session: fakeSession({
      ok: true,
      accent: "#38bdf8",
      secondary: "#818cf8",
      avg: "#202020",
      avgL: 0.2,
      hero: { dataUrl: `data:image/jpeg;base64,${pngB64}`, ext: ".jpg" },
    }),
    imagePath: file,
    themesRoot,
  });
  const theme = JSON.parse(await readFile(join(themesRoot, result.dir, "theme.json"), "utf8"));
  assert.equal(theme.heroImage, "hero.jpg");
  const hero = await readFile(join(themesRoot, result.dir, "hero.jpg"));
  assert.equal(hero.toString("base64"), pngB64);
});

test("createThemeFromImage 同名且不 force 时报错", async () => {
  const file = join(dir, "dup.png");
  await writeFile(file, Buffer.from("89504e470d0a1a0a", "hex"));
  const themesRoot = join(dir, "themes");
  const opts = {
    session: fakeSession({ ok: true, accent: "#38bdf8", secondary: "#38bdf8", avg: "#202020", avgL: 0.2 }),
    imagePath: file,
    themesRoot,
  };
  await createThemeFromImage(opts);
  await assert.rejects(() => createThemeFromImage(opts), /已存在/);
});

test("createThemeFromImage 取色失败时错误透传", async () => {
  const file = join(dir, "bad.png");
  await writeFile(file, Buffer.from("89504e470d0a1a0a", "hex"));
  await assert.rejects(
    () => createThemeFromImage({
      session: fakeSession({ ok: false, error: "图片解码失败" }),
      imagePath: file,
      themesRoot: dir,
    }),
    /取色失败：图片解码失败/,
  );
});
