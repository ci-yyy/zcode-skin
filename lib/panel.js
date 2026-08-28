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
  var settings = { persistence: true, readingEnhance: false, miniButton: false };

  function h(tag, attrs, text) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) el.setAttribute(key, attrs[key]);
    }
    if (text != null) el.textContent = text;
    return el;
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (res) { return res.json(); });
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
    "#zcsk-launcher.zcsk-mini{width:14px;height:14px;font-size:0;opacity:.3;box-shadow:none;border-width:1px;}",
    "#zcsk-launcher.zcsk-mini:hover{width:20px;height:20px;opacity:.8;}",
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
    "#zcsk-body.zcsk-busy .zcsk-row,#zcsk-body.zcsk-busy .zcsk-action{opacity:.55;pointer-events:none;}",
    ".zcsk-swatches{display:flex;gap:2px;flex:none;}",
    ".zcsk-swatch{width:5px;height:18px;border-radius:2px;}",
    ".zcsk-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".zcsk-kind{font-size:11px;flex:none;}",
    ".zcsk-check{flex:none;color:#7ee2a8;font-size:12px;width:14px;text-align:center;}",
    ".zcsk-msg{padding:18px 14px;text-align:center;color:rgba(232,234,240,.55);white-space:pre-line;}",
    ".zcsk-action{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;cursor:pointer;"
      + "border:1px dashed rgba(255,255,255,.18);color:rgba(232,234,240,.75);margin:2px 0;}",
    ".zcsk-action:hover{background:rgba(255,255,255,.07);color:#fff;}",
    ".zcsk-action input[type=file]{display:none;}",
    "#zcsk-foot{border-top:1px solid rgba(255,255,255,.09);padding:8px;}",
    ".zcsk-toggles{display:flex;gap:6px;margin-bottom:6px;}",
    ".zcsk-toggle{flex:1;padding:6px 0;border:1px solid rgba(255,255,255,.12);border-radius:8px;"
      + "background:rgba(255,255,255,.04);color:rgba(232,234,240,.6);font-size:11.5px;cursor:pointer;"
      + "font-family:inherit;transition:all .15s ease;}",
    ".zcsk-toggle.zcsk-on{background:rgba(126,226,168,.16);border-color:rgba(126,226,168,.45);color:#7ee2a8;}",
    "#zcsk-restore{width:100%;padding:7px 0;border:none;border-radius:8px;background:rgba(255,255,255,.06);"
      + "color:rgba(232,234,240,.75);font:12px -apple-system,'PingFang SC',system-ui,sans-serif;cursor:pointer;}"
      + "#zcsk-restore:hover{background:rgba(255,255,255,.12);color:#fff;}",
    "#zcsk-hint{padding:6px 2px 2px;text-align:center;font-size:10.5px;color:rgba(232,234,240,.35);}",
  ].join("\n");
  (document.head || document.documentElement).appendChild(style);

  // ---------- 悬浮按钮 ----------
  var launcher = h("button", {
    id: "zcsk-launcher",
    type: "button",
    "data-zcsk-root": "1",
    title: "ZCode 主题中心（拖到按钮上右键可收起）",
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
  var toggles = h("div", { class: "zcsk-toggles" });
  var persistToggle = h("button", { class: "zcsk-toggle", type: "button", title: "开着：ZCode 刷新/重启后自动恢复皮肤；关掉：下次启动恢复官方外观" }, "🔁 常驻");
  var readingToggle = h("button", { class: "zcsk-toggle", type: "button", title: "给 AI 回复和思考块加半透明底色，背景图主题下更容易读" }, "📖 阅读");
  toggles.appendChild(persistToggle);
  toggles.appendChild(readingToggle);
  foot.appendChild(toggles);
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

  // 收起为小圆点（heige 同款交互）：按住 Cmd 点击按钮切换；小圆点悬停会放大，点击照常打开
  launcher.addEventListener("click", function (e) {
    if (!e.metaKey && !e.ctrlKey) return;
    e.stopImmediatePropagation();
    setMini(!settings.miniButton);
  });

  function applyMini() {
    if (settings.miniButton) launcher.classList.add("zcsk-mini");
    else launcher.classList.remove("zcsk-mini");
  }

  function setMini(value) {
    settings.miniButton = value;
    applyMini();
    fetchJson(API + "/settings/miniButton", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: value }),
    }).catch(function () {});
  }

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

  function renderToggles() {
    persistToggle.classList.toggle("zcsk-on", settings.persistence);
    readingToggle.classList.toggle("zcsk-on", settings.readingEnhance);
  }

  function renderRows(themes) {
    lastThemes = themes;
    var frag = document.createDocumentFragment();

    // 顶部三行操作：上传图片 / 随机主题 / 收起按钮
    var uploadRow = h("label", { class: "zcsk-action", title: "选一张图片，自动取色生成新主题" });
    uploadRow.appendChild(document.createTextNode("＋ 自定义图片"));
    var fileInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
    uploadRow.appendChild(fileInput);
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files[0]) uploadImage(fileInput.files[0]);
      fileInput.value = "";
    });
    frag.appendChild(uploadRow);

    var randomRow = h("div", { class: "zcsk-action", title: "随机换一套" }, "🎲 随机主题");
    randomRow.addEventListener("click", function () { applyRandom(); });
    frag.appendChild(randomRow);

    var miniRow = h("div", { class: "zcsk-action", title: "把 🎨 按钮收成小圆点（Cmd+点击按钮也可切换）" },
      settings.miniButton ? "● 恢复大按钮" : "● 收起为小圆点");
    miniRow.addEventListener("click", function () {
      setMini(!settings.miniButton);
      renderRows(lastThemes);
    });
    frag.appendChild(miniRow);

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
    fetchJson(API + "/themes")
      .then(function (data) {
        currentDir = data.current || null;
        if (data.settings) settings = data.settings;
        applyMini();
        renderToggles();
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
    fetchJson(API + "/css/" + encodeURIComponent(dir))
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "生成主题失败");
        swapSkin(data.css, data.id);
        currentDir = dir;
        renderRows(lastThemes);
        // 告诉守护进程记住这个选择（失败不影响换肤本身）
        fetchJson(API + "/applied/" + encodeURIComponent(dir), { method: "POST" }).catch(function () {});
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

  function applyRandom() {
    if (applying) return;
    applying = true;
    body.classList.add("zcsk-busy");
    currentEl.textContent = "随机中…";
    fetchJson(API + "/random")
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "随机失败");
        swapSkin(data.css, data.id);
        currentDir = data.dir;
        renderRows(lastThemes);
      })
      .catch(function (e) {
        currentEl.textContent = "❌ " + (e && e.message ? e.message : "随机失败");
        setTimeout(updateCurrentLabel, 2000);
      })
      .finally(function () {
        applying = false;
        body.classList.remove("zcsk-busy");
      });
  }

  function uploadImage(file) {
    if (applying) return;
    if (file.size > 20 * 1024 * 1024) {
      currentEl.textContent = "❌ 图片超过 20MB";
      setTimeout(updateCurrentLabel, 2000);
      return;
    }
    applying = true;
    body.classList.add("zcsk-busy");
    currentEl.textContent = "生成主题中…";
    var form = new FormData();
    form.append("file", file, file.name);
    form.append("name", file.name.replace(/\.[a-z0-9]+$/i, ""));
    fetchJson(API + "/upload-theme", { method: "POST", body: form })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "生成失败");
        return fetchJson(API + "/css/" + encodeURIComponent(data.dir))
          .then(function (cssData) {
            if (!cssData.ok) throw new Error(cssData.error || "生成主题失败");
            swapSkin(cssData.css, cssData.id);
            currentDir = data.dir;
            return fetchJson(API + "/themes").then(function (list) {
              currentDir = list.current || data.dir;
              settings = list.settings || settings;
              renderToggles();
              renderRows(list.themes || []);
            });
          });
      })
      .catch(function (e) {
        currentEl.textContent = "❌ " + (e && e.message ? e.message : "上传失败");
        setTimeout(updateCurrentLabel, 2500);
      })
      .finally(function () {
        applying = false;
        body.classList.remove("zcsk-busy");
      });
  }

  function setSetting(key, value) {
    settings[key] = value;
    renderToggles();
    fetchJson(API + "/settings/" + key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: value }),
    }).catch(function () {});
  }

  persistToggle.addEventListener("click", function () {
    setSetting("persistence", !settings.persistence);
  });
  readingToggle.addEventListener("click", function () {
    setSetting("readingEnhance", !settings.readingEnhance);
  });

  restoreBtn.addEventListener("click", function () {
    if (applying || currentDir === null) return;
    applying = true;
    var previous = document.getElementById(STYLE_ID);
    if (previous) previous.remove();
    currentDir = null;
    renderRows(lastThemes);
    fetchJson(API + "/applied/none", { method: "POST" }).catch(function () {});
    applying = false;
  });

  return { injected: true };
})();
