#!/usr/bin/env node
// lib/menu.mjs — 交互式换肤菜单（use-skin.sh 的实际实现）
// 菜单、编号选择、名字模糊匹配都在 Node 里做，避开老 bash 的兼容坑。

import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 9343;

const isMain = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

export async function loadThemes() {
  const themesRoot = join(root, "themes");
  const dirs = (await readdir(themesRoot, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const themes = [];
  for (const dir of dirs) {
    try {
      const theme = JSON.parse(await readFile(join(themesRoot, dir, "theme.json"), "utf8"));
      themes.push({
        dir,
        name: theme.name || dir,
        appearance: theme.appearance === "light" ? "light" : "dark",
        bg: theme.heroImage ? "🖼 背景图" : theme.heroCss ? "🎨 渐变" : "",
      });
    } catch {
      // theme.json 无效的目录不进菜单
    }
  }
  return themes;
}

async function portOpen() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function runNode(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  return result.status === 0;
}

// 归一化：去掉空格和中点，让「原神·晨曦」「原神 · 晨曦」「原神晨曦」都能匹配
const normalize = (s) => s.replace(/[\s·・]/g, "").toLowerCase();

// 导出给测试；菜单交互本身在 main() 里
export function matchThemes(themes, query) {
  const byDir = themes.filter(
    (t) => t.dir === query || t.dir.includes(query.toLowerCase()),
  );
  if (byDir.length > 0) return byDir;
  return themes.filter((t) => normalize(t.name).includes(normalize(query)));
}

function printMenu(themes) {
  console.log("可用主题：\n");
  themes.forEach((t, i) => {
    const icon = t.appearance === "light" ? "☀️" : "🌙";
    const line = `  ${icon} ${String(i + 1).padStart(2)}. ${t.dir.padEnd(24)} ${t.name}`;
    console.log(t.bg ? `${line}  ${t.bg}` : line);
  });
  console.log("");
}

async function applyTheme(theme) {
  console.log(`\n切换到：${theme.name}（${theme.dir}）`);
  const ok = runNode([
    join(root, "apply.mjs"),
    "--port", String(PORT),
    "--theme", join(root, "themes", theme.dir),
    "--wait", "5000",
  ]);
  process.exit(ok ? 0 : 1);
}

async function main() {
  const arg = process.argv[2]?.trim();

  if (!(await portOpen())) {
    console.log("❌ ZCode 的调试端口(9343)没开。");
    console.log("");
    console.log("   如果 ZCode 正在运行但没带皮肤模式，需要重启一次：");
    console.log(`     bash ${root}/apply-skin.sh`);
    console.log("   （会自动完成：退出 ZCode → 带端口重启 → 注入默认皮肤）");
    process.exit(1);
  }

  if (arg === "还原" || arg === "restore") {
    process.exit(runNode([join(root, "restore.mjs"), "--port", String(PORT)]) ? 0 : 1);
  }

  const themes = await loadThemes();
  if (themes.length === 0) {
    console.log("❌ themes/ 里没有可用主题");
    process.exit(1);
  }

  let query = arg;
  if (!query) {
    printMenu(themes);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    query = (await rl.question("输入编号或名字切换（直接回车退出）: ")).trim();
    rl.close();
    if (!query) process.exit(0);
    if (query === "还原" || query === "restore") {
      process.exit(runNode([join(root, "restore.mjs"), "--port", String(PORT)]) ? 0 : 1);
    }
  }

  // 编号选择
  if (/^\d+$/.test(query)) {
    const theme = themes[Number(query) - 1];
    if (!theme) {
      console.log(`❌ 编号超出范围（1-${themes.length}）`);
      process.exit(1);
    }
    await applyTheme(theme);
  }

  const matches = matchThemes(themes, query);
  if (matches.length === 0) {
    printMenu(themes);
    console.log(`❌ 没找到匹配「${query}」的主题`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.log(`匹配到 ${matches.length} 个，默认切第一个；想换另一个就多打几个字：`);
    matches.forEach((t) => console.log(`   ${t.dir}  ${t.name}`));
  }
  await applyTheme(matches[0]);
}

// 被测试 import 时不进交互主流程
if (isMain) {
  main().catch((error) => {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  });
}
