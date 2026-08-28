// lib/panel.js — 「🎨 主题中心」界面，注入到 ZCode 页面里运行
// 由 daemon.mjs 注入：先设置 window.__ZCSK_CONFIG__ = { port, styleId }，再执行本文件。
// 设计约束：
//   · 零依赖、只访问本机守护进程（http://127.0.0.1:<port>），不碰外部网络
//   · 不用类名选择器，全部用 #zcsk-* 前缀的 ID，避免被 ZCode 的样式影响
//   · 注入的所有根元素带 data-zcsk-root 标记，restore / 卸载时能整体移除
//   · 自带幂等：重复注入时直接退出（返回 { injected: false }）
(function () {
  "use strict";

  var cfg = window.__ZCSK_CONFIG__;
  if (!cfg || !cfg.port || !cfg.styleId) return { injected: false, reason: "config" };
  if (document.getElementById("zcsk-launcher")) return { injected: false, reason: "exists" };

  var API = "http://127.0.0.1:" + cfg.port;
  var STYLE_ID = cfg.styleId;

  var currentDir = null; // 当前主题（目录名）；null = 官方外观
  var lastThemes = [];   // 最近一次主题列表，切换后原地刷新勾选状态
  var applying = false;

  function h(tag, attrs, text) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) el.setAttribute(key, attrs[key]);
    }
    if (text != null) el.textContent = text;
    return el;
  }

  // ---------- 样式 ----------
  var style = h("style", { id: "zcsk-panel-style", "data-zcsk-root": "1" });
  style.textContent = [
    "#zcsk-launcher{position:fixed;right:16px;bottom:150px;width:36px;height:36px;border-radius:50%;"
      + "border:1px solid rgba(255,255,255,.3);background:rgba(16,18,24,.55);color:#fff;font-size:16px;"
      + "line-height:1;padding:0;cursor:pointer;opacity:.45;z-index:2147483646;display:flex;"
      + "align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,.35);"
      + "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);"
      + "font-family:-apple-system,'PingFang SC',system-ui,sans-serif;"
      + "transition:opacity .18s ease,transform .18s ease,background-color .18s ease;}",
    "#zcsk-launcher:hover{opacity:1;background:rgba(16,18,24,.82);transform:scale(1.08);}",
    "#zcsk-panel{position:fixed;right:16px;bottom:196px;width:304px;max-height:min(560px,72vh);display:none;"
      + "flex-direction:column;border-radius:14px;background:rgba(17,19,26,.94);"
      + "border:1px solid rgba(255,255,255,.13);box-shadow:0 12px 40px rgba(0,0,0,.5);"
      + "backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:#e8eaf0;"
      + "font:13px/1.5 -apple-system,'PingFang SC',system-ui,sans-serif;z-index:2147483647;"
      + "overflow:hidden;user-select:none;}",
    "#zcsk-panel.zcsk-open{display:flex;}",
    "#zcsk-head{display:flex;align-items:center;gap:8px;padding:12px 14px 10px;"
      + "border-bottom:1px solid rgba(255,255,255,.09);}",
    "#zcsk-title{font-weight:600;font-size:13.5px;white-space:nowrap;}",
    "#zcsk-current{font-size:11px;color:rgba(232,234,240,.55);margin-left:auto;max-width:132px;"
      + "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    "#zcsk-close{width:24px;height:24px;border:none;border-radius:6px;background:transparent;"
      + "color:rgba(232,234,240,.6);font-size:14px;cursor:pointer;padding:0;line-height:1;flex:none;}",
    "#zcsk-close:hover{background:rgba(255,255,255,.1);color:#fff;}",
    "#zcsk-body{overflow-y:auto;padding:6px;flex:1;scrollbar-width:thin;"
      + "scrollbar-color:rgba(255,255,255,.2) transparent;}",
    "#zcsk-body::-webkit-scrollbar{width:6px;}"
      + "#zcsk-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.18);border-radius:3px;}",
    ".zcsk-row{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:9px;cursor:pointer;"
      + "border:1px solid transparent;}",
    ".zcsk-row:hover{background:rgba(255,255,255,.07);}",
    ".zcsk-row.zcsk-active{background:rgba(255,255,255,.09);border-color:rgba(255,255,255,.14);}",
    "#zcsk-body.zcsk-busy .zcsk-row{opacity:.55;pointer-events:none;}",
    ".zcsk-swatches{display:flex;gap:2px;flex:none;}",
    ".zcsk-swatch{width:5px;height:18px;border-radius:2px;}",
    ".zcsk-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".zcsk-kind{font-size:11px;flex:none;}",
    ".zcsk-check{flex:none;color:#7ee2a8;font-size:12px;width:14px;text-align:center;}",
    ".zcsk-msg{padding:18px 14px;text-align:center;color:rgba(232,234,240,.55);white-space:pre-line;}",
    "#zcsk-foot{border-top:1px solid rgba(255,255,255,.09);padding:8px;}",
    "#zcsk-restore{width:100%;padding:7px 0;border:none;border-radius:8px;background:rgba(255,255,255,.06);"
      + "color:rgba(232,234,240,.75);font:12px -apple-system,'PingFang SC',system-ui,sans-serif;cursor:pointer;}",
    "#zcsk-restore:hover{background:rgba(255,255,255,.12);color:#fff;}",
    "#zcsk-hint{padding:6px 2px 2px;text-align:center;font-size:10.5px;color:rgba(232,234,240,.35);}",
  ].join("\n");
  (document.head || document.documentElement).appendChild(style);

  // ---------- 悬浮按钮 ----------
  var launcher = h("button", {
    id: "zcsk-launcher",
    type: "button",
    "data-zcsk-root": "1",
    title: "ZCode 主题中心",
    "aria-label": "ZCode 主题中心",
  }, "🎨");
  document.body.appendChild(launcher);

  // ---------- 面板骨架 ----------
  var panel = h("div", { id: "zcsk-panel", "data-zcsk-root": "1", role: "dialog" });
  var head = h("div", { id: "zcsk-head" });
  head.appendChild(h("div", { id: "zcsk-title" }, "🎨 主题中心"));
  var currentEl = h("div", { id: "zcsk-current" }, "");
  head.appendChild(currentEl);
  head.appendChild(h("button", { id: "zcsk-close", type: "button", title: "关闭" }, "✕"));

  var body = h("div", { id: "zcsk-body" });
  var foot = h("div", { id: "zcsk-foot" });
  foot.appendChild(h("button", { id: "zcsk-restore", type: "button" }, "还原官方外观"));
  foot.appendChild(h("div", { id: "zcsk-hint" }, "切换立即生效，无需重启"));

  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(foot);
  document.body.appendChild(panel);
  var closeBtn = panel.querySelector("#zcsk-close");
  var restoreBtn = panel.querySelector("#zcsk-restore");

  // ---------- 交互 ----------
  function isOpen() {
    return panel.classList.contains("zcsk-open");
  }

  function openPanel() {
    panel.classList.add("zcsk-open");
    loadThemes();
  }

  function closePanel() {
    panel.classList.remove("zcsk-open");
  }

  launcher.addEventListener("click", function (e) {
    e.stopPropagation();
    if (isOpen()) closePanel();
    else openPanel();
  });
  closeBtn.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) closePanel();
  });
  // 点面板/按钮以外的地方关闭
  document.addEventListener("pointerdown", function (e) {
    if (!isOpen()) return;
    if (panel.contains(e.target) || launcher.contains(e.target)) return;
    closePanel();
  }, true);

  function updateCurrentLabel() {
    currentEl.textContent = currentDir
      ? "当前：" + nameOf(currentDir)
      : "当前：官方外观";
  }

  function nameOf(dir) {
    for (var i = 0; i < lastThemes.length; i++) {
      if (lastThemes[i].dir === dir) return lastThemes[i].name;
    }
    return dir;
  }

  function renderRows(themes) {
    lastThemes = themes;
    var frag = document.createDocumentFragment();
    themes.forEach(function (t) {
      var row = h("div", {
        class: "zcsk-row" + (t.dir === currentDir ? " zcsk-active" : ""),
        "data-zcsk-dir": t.dir,
        title: t.dir,
      });
      var swatches = h("span", { class: "zcsk-swatches" });
      (t.swatches && t.swatches.length ? t.swatches : ["#666666"]).forEach(function (color) {
        swatches.appendChild(h("span", { class: "zcsk-swatch", style: "background:" + color }));
      });
      row.appendChild(swatches);
      row.appendChild(h("span", { class: "zcsk-name" }, t.name));
      row.appendChild(h("span", { class: "zcsk-kind" }, t.appearance === "light" ? "☀️" : "🌙"));
      row.appendChild(h("span", { class: "zcsk-check" }, t.dir === currentDir ? "✓" : ""));
      row.addEventListener("click", function () {
        applyTheme(t.dir);
      });
      frag.appendChild(row);
    });
    body.replaceChildren(frag);
    updateCurrentLabel();
  }

  function loadThemes() {
    body.classList.remove("zcsk-busy");
    body.replaceChildren(h("div", { class: "zcsk-msg" }, "加载主题列表…"));
    fetch(API + "/themes")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        currentDir = data.current || null;
        renderRows(data.themes || []);
      })
      .catch(function () {
        body.replaceChildren(
          h("div", { class: "zcsk-msg" }, "❌ 连不上皮肤服务\n（守护进程没在运行？）"),
        );
      });
  }

  // 换肤与 apply.mjs 注入的是同一个 <style> 元素（id 相同），
  // 终端 use-skin.sh 和面板两条路互不冲突
  function swapSkin(cssText, themeKey) {
    var previous = document.getElementById(STYLE_ID);
    if (previous) previous.remove();
    var el = document.createElement("style");
    el.id = STYLE_ID;
    el.setAttribute("data-zcode-skin", themeKey);
    el.textContent = cssText;
    (document.head || document.documentElement).appendChild(el);
  }

  function applyTheme(dir) {
    if (applying || dir === currentDir) return;
    applying = true;
    body.classList.add("zcsk-busy");
    currentEl.textContent = "切换中…";
    fetch(API + "/css/" + encodeURIComponent(dir))
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "生成主题失败");
        swapSkin(data.css, data.id);
        currentDir = dir;
        renderRows(lastThemes);
        // 告诉守护进程记住这个选择（失败不影响换肤本身）
        fetch(API + "/applied/" + encodeURIComponent(dir), { method: "POST" }).catch(function () {});
      })
      .catch(function (e) {
        currentEl.textContent = "❌ " + (e && e.message ? e.message : "切换失败");
        setTimeout(updateCurrentLabel, 2000);
      })
      .finally(function () {
        applying = false;
        body.classList.remove("zcsk-busy");
      });
  }

  restoreBtn.addEventListener("click", function () {
    if (applying || currentDir === null) return;
    applying = true;
    var previous = document.getElementById(STYLE_ID);
    if (previous) previous.remove();
    currentDir = null;
    renderRows(lastThemes);
    fetch(API + "/applied/none", { method: "POST" }).catch(function () {});
    applying = false;
  });

  return { injected: true };
})();
