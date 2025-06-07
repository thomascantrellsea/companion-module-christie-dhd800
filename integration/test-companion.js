#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  installCleanupHandlers,
  startDummyStoreServer,
  copyModuleFiles,
  runDev,
  runSync,
} = require("./companion-runner");
const {
  startMockServer,
  startProxyServer,
  runProjectorTests,
} = require("./christie-projector");

const savePreview =
  process.argv.includes("--save-preview") || process.env.SAVE_PREVIEW === "1";

const keepRunning =
  process.argv.includes("--keep-running") || process.env.KEEP_RUNNING === "1";

let projectorIp = null;
const ipIndex = process.argv.indexOf("--projector-ip");
if (ipIndex !== -1 && process.argv[ipIndex + 1]) {
  projectorIp = process.argv[ipIndex + 1];
} else if (process.env.PROJECTOR_IP) {
  projectorIp = process.env.PROJECTOR_IP;
}

(async () => {
  const repoRoot = process.cwd();
  const companionDir = path.join(repoRoot, "externals", "companion");
  if (!fs.existsSync(companionDir)) {
    console.error(`Directory not found: ${companionDir}`);
    process.exit(1);
  }
  process.chdir(companionDir);
  console.log("📂  Working directory →", process.cwd());
  installCleanupHandlers();

  try {
    const {
      server: mockServer,
      messages,
      setPower,
    } = projectorIp
      ? await startProxyServer(projectorIp)
      : await startMockServer();
    if (projectorIp) {
      console.log(`\n🔌 Using real projector at ${projectorIp}`);
    }

    await copyModuleFiles(repoRoot);

    const { server: storeServer, port: storePort } =
      await startDummyStoreServer();
    process.env.STAGING_MODULE_API = `http://127.0.0.1:${storePort}`;

    console.log("\n📦  yarn install");
    runSync("yarn", ["install"]);

    console.log("\n🚀  yarn dev");
    if (keepRunning) {
      console.log(
        "ℹ️  keep-running mode enabled – Companion will stay running on failure",
      );
    }
    await runDev(messages, setPower, keepRunning, (port) =>
      runProjectorTests(messages, port, setPower, savePreview),
    );
    storeServer.close();
    mockServer.close();
    console.log("\n✅ christie-dhd800 integration tests successful");
    process.exit(0);
  } catch (err) {
    console.error("\n❌", err.message || err);
    process.exit(1);
  }
})();
