#!/usr/bin/env node
// create-theme.mjs — 一张图片生成一套主题（自动取色）
//
// 用法：
//   node create-theme.mjs --image /path/to/图片.jpg --name "我的主题"
//   node create-theme.mjs --image ~/Downloads/wall.png --name 名字 --id my-id
//   node create-theme.mjs --image 图.png --name 名字 --appearance dark   # 强制深色（默认按图片亮度自动判断）
//   node create-theme.mjs --image 图.png --name 名字 --force             # 覆盖已有同名主题
//
// 原理：把图片发给 ZCode 渲染进程，用页面里的 canvas 采样像素、统计色彩
// （主色、辅色、整体明暗），再套用与移植主题相同的颜色映射，生成完整主题目录。
// 需要 ZCode 带调试端口运行（用 apply-skin.sh 启动过一次就行）。
// 面板里的「＋ 自定义图片」走的是同一段逻辑（lib/autocolor.mjs）。

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CdpSession, classifyTargets, DEFAULT_PORT, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { createThemeFromImage } from "./lib/autocolor.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = { image: null, name: null, id: null, appearance: "auto", port: DEFAULT_PORT, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--image") opts.image = argv[++i];
    else if (arg === "--name") opts.name = argv[++i];
    else if (arg === "--id") opts.id = argv[++i];
    else if (arg === "--appearance") opts.appearance = argv[++i];
    else if (arg === "--port") opts.port = Number(argv[++i]);
    else if (arg === "--force") opts.force = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!opts.image) throw new Error("必须用 --image 指定图片路径");
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 找 ZCode 主窗口
  const { target } = pickMainWindow(classifyTargets(await listTargets(opts.port, { timeoutMs: 2000 })));
  if (!target) {
    throw new Error(`没连上 ZCode 调试端口 ${opts.port}。先跑一次 apply-skin.sh（或确认 ZCode 带端口在运行）再生成主题。`);
  }

  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  let result;
  try {
    result = await createThemeFromImage({
      session,
      imagePath: opts.image,
      name: opts.name,
      id: opts.id,
      appearance: opts.appearance,
      force: opts.force,
      themesRoot: join(here, "themes"),
    });
  } finally {
    session.close();
  }

  console.log(`✅ 主题「${result.name}」已生成：themes/${result.dir}/`);
  console.log(`   深浅判断：${result.appearance}（按图片平均亮度自动判定）`);
  console.log(`   立即使用：bash use-skin.sh ${result.dir}`);
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
