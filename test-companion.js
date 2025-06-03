#!/usr/bin/env node
/**
 * setup-companion.js
 *
 * Automates local-development wiring for the Christie DHD800 Companion module.
 *
 *  Steps performed:
 *  1. cd externals/companion
 *  2. Copy module files into module-local-dev/companion-module-christie-dhd800
 *  3. yarn install
 *  4. yarn dev:inner    (stream logs, watch for errors)
 *     • Terminates after 30 s with an aggressive kill strategy:
 *         – First sends SIGTERM to the **entire process group**
 *         – After a 2 s grace period, escalates to SIGKILL
 *         – On Windows, falls back to `taskkill /T /F`
 *
 * Usage:  node setup-companion.js   (run from repo root)
 */
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const net = require("net");

// ---------- helper: start mock tcp server ----------
function startMockServer() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("data", (d) => {
        console.log("mock server received:", d.toString().trim());
      });
    });
    server.listen(10000, "127.0.0.1", () => resolve(server));
  });
}

// ---------- helper: copy module files ----------
async function copyModuleFiles(repoRoot) {
  const destDir = path.join(
    "module-local-dev",
    "companion-module-christie-dhd800",
  );

  // Ensure destination directory exists
  try {
    const stats = await fsPromises.lstat(destDir);
    if (!stats.isDirectory()) {
      await fsPromises.rm(destDir, { recursive: true, force: true });
      await fsPromises.mkdir(destDir, { recursive: true });
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      await fsPromises.mkdir(destDir, { recursive: true });
    } else {
      throw err;
    }
  }

  const files = [
    "main.js",
    "yarn.lock",
    "package.json",
    path.join("companion", "manifest.json"),
  ];

  for (const rel of files) {
    const src = path.join(repoRoot, rel);
    const dest = path.join(destDir, path.basename(rel));
    await fsPromises.copyFile(src, dest);
  }

  console.log(`✔︎ Files copied to ${destDir}`);
}

// ---------- helper: run sync command ----------
function runSync(cmd, args = []) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited code ${res.status}`);
}

// ---------- helper: group‑kill with escalation ----------
function killProcessTree(child) {
  if (process.platform === "win32") {
    // /T  kill child + sub‑processes, /F force
    spawnSync("taskkill", ["/PID", child.pid, "/T", "/F"]);
    return;
  }

  try {
    // Negative PID ⇒ signal entire process group
    process.kill(-child.pid, "SIGTERM");
  } catch (_) {}

  // escalate after grace period
  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (_) {}
  }, 2_000);
}

// ---------- helper: run yarn dev:inner with 30‑s watchdog ----------
function runDev() {
  return new Promise((resolve, reject) => {
    const proc = spawn("yarn", ["dev:inner"], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    let success = true;
    let serverReady = false;

    const watch = (data) => {
      const text = data.toString();
      process.stdout.write(text);

      if (/new url:/i.test(text) && !serverReady) {
        serverReady = true;
        runHttpTests()
          .then(() => {
            killProcessTree(proc);
          })
          .catch((err) => {
            console.error("HTTP tests failed", err);
            success = false;
            killProcessTree(proc);
          });
      }

      if (
        /Error:/i.test(text) ||
        /ERR_/i.test(text) ||
        /Access to this API has been restricted/i.test(text)
      ) {
        success = false;
      }
    };

    proc.stdout.on("data", watch);
    proc.stderr.on("data", watch);

    const timer = setTimeout(() => {
      console.log("\n⏰  30 s elapsed – terminating dev process");
      killProcessTree(proc);
    }, 30_000);

    proc.on("close", () => {
      clearTimeout(timer);
      if (success) resolve();
      else reject(new Error("christie-dhd800 module did not start cleanly"));
    });
  });
}

async function runHttpTests() {
  const http = require("http");
  return new Promise((resolve, reject) => {
    http
      .get("http://127.0.0.1:8000", (res) => {
        if (res.statusCode !== 200) {
          reject(new Error("unexpected http status " + res.statusCode));
          return;
        }
        res.resume();
        res.on("end", resolve);
      })
      .on("error", reject);
  });
}

// ---------- main ----------
(async () => {
  // 1. enter externals/companion
  const repoRoot = process.cwd();
  const companionDir = path.join(repoRoot, "externals", "companion");
  if (!fs.existsSync(companionDir)) {
    console.error(`Directory not found: ${companionDir}`);
    process.exit(1);
  }
  process.chdir(companionDir);
  console.log("📂  Working directory →", process.cwd());

  try {
    const mockServer = await startMockServer();

    // 2. copy module files
    await copyModuleFiles(repoRoot);

    // 3. yarn install
    console.log("\n📦  yarn install");
    runSync("yarn", ["install"]);

    // 4. yarn dev:inner with watchdog
    console.log("\n🚀  yarn dev");
    await runDev();

    mockServer.close();
    console.log("\n✅ christie-dhd800 restart appears successful");
    process.exit(0);
  } catch (err) {
    console.error("\n❌", err.message || err);
    process.exit(1);
  }
})();
