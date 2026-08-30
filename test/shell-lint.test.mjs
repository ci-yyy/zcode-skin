// test/shell-lint.test.mjs — shell 脚本静态检查
// 背景：`$DIR？`（变量名后紧跟全角字符）在 UTF-8 locale 下 bash 会把多字节字符
// 并入变量名，set -u 时报 `unbound variable` 崩掉——v1.2.2 的 uninstall.sh 就是在
// 删除确认那行崩的。规则：$VAR 后要跟非 ASCII 字符时必须写成 ${VAR}。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("$VAR 后面不直接跟多字节字符（必须用 ${VAR} 定界）", () => {
  const offenders = [];
  for (const f of readdirSync(root).filter((n) => n.endsWith(".sh"))) {
    const lines = readFileSync(join(root, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = line.match(/\$[A-Za-z_][A-Za-z0-9_]*[^\x00-\x7f]/);
      if (m) offenders.push(`${f}:${i + 1} → ${m[0]}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `bash 在 UTF-8 locale 下会把多字节字符并进变量名（set -u 崩溃）。改用 \${VAR}：\n${offenders.join("\n")}`,
  );
});
