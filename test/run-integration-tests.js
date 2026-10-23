const { spawnSync } = require("child_process");
const path = require("path");
const bin = require.resolve("mocha/bin/mocha.js", {
  paths: [path.join(__dirname, ".."), path.join(__dirname, "../node_modules/@iobroker/testing")],
});
const r = spawnSync(process.execPath, [bin, "--config", "test/mocharc.custom.json", "test/integration", "--exit"], {
  stdio: "inherit",
});
process.exit(r.status || 0);
