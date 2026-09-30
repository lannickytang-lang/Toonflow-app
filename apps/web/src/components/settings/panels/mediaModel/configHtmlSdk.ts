/** 注入供应商 config.html iframe 的桥接 SDK 构建器。
 *  initConfig 在组装时内联（转义 < 防 </script> 截断），getConfig 首调即有值，避免 init 消息竞态。 */
export function buildConfigHtmlSdk(initialConfig: Record<string, unknown>, themeMode: string) {
  const inlineConfig = JSON.stringify(initialConfig).replace(/</g, "\\u003c") || "{}";
  return `(function () {
  "use strict";
  var initConfig = ${inlineConfig};
  var pending = new Map();
  var seq = 0;
  var heightTimer = 0;
  function send(message) { parent.postMessage(Object.assign({ __toonflow: true }, message), "*"); }
  // ACT: 高度上报防抖——宿主调高容器会再触发 iframe resize，不防抖会形成上报风暴。
  function reportHeight() {
    clearTimeout(heightTimer);
    heightTimer = setTimeout(function () {
      send({ type: "toonflow:height", height: Math.ceil(document.documentElement.scrollHeight) });
    }, 150);
  }
  window.toonflow = {
    theme: { mode: "${themeMode}" },
    ready: function () { send({ type: "toonflow:ready" }); reportHeight(); },
    getConfig: function () { return Promise.resolve(initConfig); },
    setConfig: function (config) { send({ type: "toonflow:change", config: config || {} }); },
    validate: function (config) {
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        pending.set(id, { resolve: resolve, reject: reject });
        send({ type: "toonflow:validate", id: id, config: config });
        setTimeout(function () {
          if (pending.has(id)) { pending.delete(id); reject(new Error("校验请求超时")); }
        }, 30000);
      });
    },
  };
  addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.__toonflow !== true) return;
    if (data.type === "toonflow:init") initConfig = data.config;
    else if (data.type === "toonflow:validateResult") {
      var entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      var result = data.result || { ok: false, errors: ["校验请求失败"] };
      if (result.ok) entry.resolve(result);
      else entry.reject(new Error((result.errors || ["校验未通过"]).join("；")));
    }
  });
  addEventListener("load", reportHeight);
  addEventListener("resize", reportHeight);
})();`;
}
