#!/usr/bin/env node
// restore.mjs — 移除注入的皮肤，恢复 ZCode 官方外观（不重启、不动数据）
// 注意：这只移除当前注入；下次用 launch.sh 启动会再次上皮肤。
// 想彻底回到官方外观：完全退出 ZCode，从启动台正常打开即可。

import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { STYLE_ID } from "./lib/theme.mjs";

const REMOVE_SCRIPT = `(() => {
  const style = document.getElementById(${JSON.stringify(STYLE_ID)});
  if (!style) return { removed: false, reason: "当前没有注入皮肤" };
  style.remove();
  const computed = getComputedStyle(document.documentElement);
  return {
    removed: true,
    sidebarVar: computed.getPropertyValue("--color-sidebar").trim(),
  };
})()`;

async function main() {
  const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || DEFAULT_PORT;
  let targets;
  try {
    targets = await listTargets(port, { timeoutMs: 2000 });
  } catch {
    throw new Error(
      `连不上调试端口 ${port}。ZCode 可能没带 --remote-debugging-port 启动；`
      + "如果 ZCode 已经是官方原样，那不需要还原。",
    );
  }
  const { target } = pickMainWindow(classifyTargets(targets));
  if (!target) throw new Error("没找到 ZCode 主窗口");

  const session = await new CdpSession(target.webSocketDebuggerUrl).open();
  try {
    const result = await session.evaluate(REMOVE_SCRIPT);
    if (result.removed) {
      console.log("✅ 皮肤已移除，ZCode 恢复官方外观");
      console.log(`   --color-sidebar 回到：${result.sidebarVar || "(空)"}`);
    } else {
      console.log(`ℹ️ ${result.reason}`);
    }
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
