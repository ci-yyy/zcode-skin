#!/usr/bin/env node
// restore.mjs — 移除注入的皮肤，恢复 ZCode 官方外观（不重启、不动数据）
// 会同时移除「🎨 主题中心」按钮，并把 state.json 记为官方外观。
// 注意：这只移除当前注入；下次用 apply-skin.sh 启动会再次上皮肤。
// 想彻底回到官方外观：完全退出 ZCode，从启动台正常打开即可。

import { DEFAULT_PORT, CdpSession, classifyTargets, listTargets, pickMainWindow } from "./lib/cdp.mjs";
import { panelRemovalScript, skinRemovalScript } from "./lib/inject.mjs";
import { updateState } from "./lib/state.mjs";

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
    const skinResult = await session.evaluate(skinRemovalScript());
    const panelResult = await session.evaluate(panelRemovalScript());
    await updateState({ theme: null });
    const computed = await session.evaluate(
      `(() => getComputedStyle(document.documentElement).getPropertyValue("--color-sidebar").trim())()`,
    );
    if (skinResult.removed) {
      console.log("✅ 皮肤已移除，ZCode 恢复官方外观");
      if (panelResult.removed) console.log("🎨 主题中心按钮已一并移除");
      console.log(`   --color-sidebar 回到：${computed || "(空)"}`);
    } else if (panelResult.removed) {
      console.log("✅ 主题中心按钮已移除（皮肤本来就没注入）");
    } else {
      console.log("ℹ️ 当前没有注入皮肤，也没有主题中心按钮");
    }
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
