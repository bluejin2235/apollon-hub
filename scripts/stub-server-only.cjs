/** tsx 검증용 — server-only 무시 */
const Module = require("module");
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === "server-only") return {};
  return orig.apply(this, arguments);
};
