// Führt die package-Tests über das transitiv installierte mocha aus (@iobroker/testing bringt es mit).
const { spawnSync } = require("child_process");
const path = require("path");
const bin = require.resolve("mocha/bin/mocha.js", {
  paths: [path.join(__dirname, ".."), path.join(__dirname, "../node_modules/@iobroker/testing")],
});
const r = spawnSync(process.execPath, [bin, "--config", "test/mocharc.custom.json", "test/package", "--exit"], {
  stdio: "inherit",
});
process.exit(r.status || 0);
