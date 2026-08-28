// lib/inject.mjs — 所有注入到 ZCode 页面里执行的脚本片段（皮肤样式 / 主题中心面板 / 阅读增强 / 状态检查）
// 集中放在一处，apply.mjs、restore.mjs、daemon.mjs 共用，保证各入口行为完全一致。

import { STYLE_ID } from "./theme.mjs";

export const PANEL_LAUNCHER_ID = "zcsk-launcher";
export const PANEL_ID = "zcsk-panel";
export const READING_STYLE_ID = "zcsk-reading";
// 主题中心注入的所有根元素都带这个标记，整体移除时统一清理
export const PANEL_ROOT_SELECTOR = "[data-zcsk-root]";

// 阅读增强：AI 回复和思考块（ZCode 里都是 .group/assistant-turn 下的 .history-message）
// 加 90% 主题自适应半透明底色；左右内边距 + 负外边距让正文的视觉宽度不变（对称留白）。
// 这是皮肤工具里唯一使用界面类名选择器的功能（默认关闭），ZCode 改版时可能需要跟进修改。
export const READING_CSS = [
  "/* ZCode Skin 阅读增强 · 可在主题中心关闭 */",
  ".group\\/assistant-turn .history-message {",
  "  background: color-mix(in srgb, var(--color-card) 90%, transparent) !important;",
  "  border-radius: 12px;",
  "  padding: 10px 18px;",
  "  margin-inline: -18px;",
  "}",
].join("\n");

// 注入皮肤：先删旧的同名 <style> 再插入新的（幂等，重复执行不会叠加）
export function skinInjectionScript(css, themeId) {
  return `(() => {
    try {
      const previous = document.getElementById(${JSON.stringify(STYLE_ID)});
      if (previous) previous.remove();
      const style = document.createElement("style");
      style.id = ${JSON.stringify(STYLE_ID)};
      style.setAttribute("data-zcode-skin", ${JSON.stringify(themeId)});
      style.textContent = ${JSON.stringify(css)};
      (document.head || document.documentElement).appendChild(style);
      const computed = getComputedStyle(document.documentElement);
      return {
        applied: true,
        bytes: style.textContent.length,
        sidebarVar: computed.getPropertyValue("--color-sidebar").trim(),
        backgroundVar: computed.getPropertyValue("--color-background").trim(),
      };
    } catch (error) {
      return { applied: false, error: String(error) };
    }
  })()`;
}

export function skinRemovalScript() {
  return `(() => {
    const style = document.getElementById(${JSON.stringify(STYLE_ID)});
    if (!style) return { removed: false };
    style.remove();
    return { removed: true };
  })()`;
}

// 阅读增强样式开关（独立于皮肤 <style>，由面板开关和守护进程维护）
export function readingInjectionScript(css) {
  return `(() => {
    const previous = document.getElementById(${JSON.stringify(READING_STYLE_ID)});
    if (previous) return { applied: true, existed: true };
    const style = document.createElement("style");
    style.id = ${JSON.stringify(READING_STYLE_ID)};
    style.setAttribute("data-zcsk-root", "1");
    style.textContent = ${JSON.stringify(css)};
    (document.head || document.documentElement).appendChild(style);
    return { applied: true, existed: false };
  })()`;
}

export function panelRemovalScript() {
  return `(() => {
    const roots = document.querySelectorAll(${JSON.stringify(PANEL_ROOT_SELECTOR)});
    roots.forEach((el) => el.remove());
    return { removed: roots.length };
  })()`;
}

// 面板注入 = 先落配置，再执行 lib/panel.js 源码（panel.js 自带幂等检查）
export function panelInjectionScript(panelSource, config) {
  return `window.__ZCSK_CONFIG__ = ${JSON.stringify(config)};\n${panelSource}`;
}

// 守护进程每轮巡检用：皮肤在不在、是哪套、主题中心按钮在不在、阅读增强在不在
export function healthScript() {
  return `(() => {
    const style = document.getElementById(${JSON.stringify(STYLE_ID)});
    const launcher = document.getElementById(${JSON.stringify(PANEL_LAUNCHER_ID)});
    const reading = document.getElementById(${JSON.stringify(READING_STYLE_ID)});
    return {
      skin: !!style,
      skinThemeId: style ? style.getAttribute("data-zcode-skin") : null,
      panel: !!launcher,
      reading: !!reading,
    };
  })()`;
}

export function statusScript() {
  return `(() => {
    const style = document.getElementById(${JSON.stringify(STYLE_ID)});
    const launcher = document.getElementById(${JSON.stringify(PANEL_LAUNCHER_ID)});
    const reading = document.getElementById(${JSON.stringify(READING_STYLE_ID)});
    const computed = getComputedStyle(document.documentElement);
    return {
      skinActive: !!style,
      themeId: style ? style.getAttribute("data-zcode-skin") : null,
      panelActive: !!launcher,
      readingActive: !!reading,
      sidebarVar: computed.getPropertyValue("--color-sidebar").trim(),
      backgroundVar: computed.getPropertyValue("--color-background").trim(),
      url: location.href,
    };
  })()`;
}
