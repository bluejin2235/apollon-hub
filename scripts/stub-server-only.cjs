const Module = require("module");
const path = require("path");
const empty = path.join(__dirname, "empty-module.cjs");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") return empty;
  return orig.call(this, request, parent, isMain, options);
};
