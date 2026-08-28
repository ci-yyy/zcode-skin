// lib/inject.mjs — 所有注入到 ZCode 页面里执行的脚本片段（皮肤样式 / 主题中心面板 / 状态检查）
// 集中放在一处，apply.mjs、restore.mjs、daemon.mjs 共用，保证各入口行为完全一致。

import { STYLE_ID } from "./theme.mjs";

export const PANEL_LAUNCHER_ID = "zcsk-launcher";
export const PANEL_ID = "zcsk-panel";
// 主题中心注入的所有根元素都带这个标记，整体移除时统一清理
export const PANEL_ROOT_SELECTOR = "[data-zcsk-root]";

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

// 守护进程每轮巡检用：皮肤在不在、是哪套、主题中心按钮在不在
export function healthScript() {
  return `(() => {
    const style = document.getElementById(${JSON.stringify(STYLE_ID)});
    const launcher = document.getElementById(${JSON.stringify(PANEL_LAUNCHER_ID)});
    return {
      skin: !!style,
      skinThemeId: style ? style.getAttribute("data-zcode-skin") : null,
      panel: !!launcher,
    };
  })()`;
}

export function statusScript() {
  return `(() => {
    const style = document.getElementById(${JSON.stringify(STYLE_ID)});
    const launcher = document.getElementById(${JSON.stringify(PANEL_LAUNCHER_ID)});
    const computed = getComputedStyle(document.documentElement);
    return {
      skinActive: !!style,
      themeId: style ? style.getAttribute("data-zcode-skin") : null,
      panelActive: !!launcher,
      sidebarVar: computed.getPropertyValue("--color-sidebar").trim(),
      backgroundVar: computed.getPropertyValue("--color-background").trim(),
      url: location.href,
    };
  })()`;
}
