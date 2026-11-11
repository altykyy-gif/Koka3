"use strict";
const {spawnSync} = require("node:child_process");
const {writeFileSync,rmSync} = require("node:fs");
const path = require("node:path");
const {root,app,projectId,host,authPort,firestorePort} = require("./paths.cjs");
const config = path.join(root, ".firebase-test-" + process.pid + ".json");
const command = ["node tests/rules-check.cjs", "node tests/browser-check.cjs"].join(" && ");

writeFileSync(config, JSON.stringify({
  firestore:{rules:path.relative(root,path.join(app,"firestore.rules"))},
  emulators:{
    auth:{host,port:authPort},firestore:{host,port:firestorePort},
    ui:{enabled:false},singleProjectMode:true,
  },
}),{flag:"wx"});
try {
  const run = spawnSync(process.execPath,[
    require.resolve("firebase-tools/lib/bin/firebase"),"emulators:exec",
    "--only","auth,firestore","--project",projectId,"--config",config,command,
  ],{cwd:root,stdio:"inherit",env:{...process.env,CI:"true"}});
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(config,{force:true});
}
