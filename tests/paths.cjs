"use strict";
const {existsSync} = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const app = existsSync(path.join(root, "app", "index.html")) ? path.join(root, "app") : root;

module.exports = {
  root, app,
  projectId: "demo-rafiq-v51",
  host: "127.0.0.1",
  authPort: 19099,
  firestorePort: 18080,
};
