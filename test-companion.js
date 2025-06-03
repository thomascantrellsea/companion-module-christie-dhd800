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
  const messages = [];
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("data", (d) => {
        const msg = d.toString().trim();
        messages.push(msg);
        console.log("mock server received:", msg);
      });
    });
    server.listen(10000, "127.0.0.1", () => resolve({ server, messages }));
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

// ---------- helper: run yarn dev:inner with 120‑s watchdog ----------
function runDev(messages) {
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
        runHttpTests(messages)
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
      console.log("\n⏰  120 s elapsed – terminating dev process");
      killProcessTree(proc);
    }, 120_000);

    proc.on("close", () => {
      clearTimeout(timer);
      if (success) resolve();
      else reject(new Error("christie-dhd800 module did not start cleanly"));
    });
  });
}

async function runHttpTests(messages) {
  const http = require("http");
  const { io } = require("socket.io-client");

  // basic connectivity check
  await new Promise((resolve, reject) => {
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

  // helper to POST to companion
  async function httpPost(path) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { method: "POST", host: "127.0.0.1", port: 8000, path },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  const socket = io("http://127.0.0.1:8000", { transports: ["websocket"] });
  await new Promise((resolve) => socket.on("connect", resolve));

  function emitPromise(event, args) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 5000);
      socket.emit(event, args, (err, res) => {
        clearTimeout(timer);
        if (err) reject(new Error(err));
        else resolve(res);
      });
    });
  }

  const connectionId = await emitPromise("connections:add", [
    { type: "christie-dhd800", product: "DHD800" },
    "autotest",
    null,
  ]);
  await emitPromise("connections:set-label-and-config", [
    connectionId,
    "autotest",
    { host: "127.0.0.1", port: 10000, password: "" },
  ]);

  const actions = {
    power_on: "C00",
    power_off: "C01",
    input_1: "C05",
    input_2: "C06",
    input_3: "C07",
    input_4: "C08",
    menu_on: "C1C",
    menu_off: "C1D",
  };

  const location = { pageNumber: 1, row: 1, column: 1 };

  for (const [actionId, cmd] of Object.entries(actions)) {
    await emitPromise("controls:reset", [location, "button"]);

    const pages = await emitPromise("pages:subscribe", []);
    const pageId = pages.order[0];
    const controlId =
      pages.pages[pageId]?.controls?.[location.row]?.[location.column];
    if (!controlId) throw new Error("control not found");

    await emitPromise("controls:entity:add", [
      controlId,
      { stepId: "0", setId: "down" },
      null,
      connectionId,
      "action",
      actionId,
    ]);

    const before = messages.length;
    await httpPost(`/api/location/1/1/1/press`);
    await new Promise((r) => setTimeout(r, 1200));
    const msg = messages.slice(before).join("\n");
    if (!msg.includes(cmd)) {
      throw new Error(`Expected command ${cmd} not seen for ${actionId}`);
    }
  }

  socket.close();
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
    const { server: mockServer, messages } = await startMockServer();

    // 2. copy module files
    await copyModuleFiles(repoRoot);

    // 3. yarn install
    console.log("\n📦  yarn install");
    runSync("yarn", ["install"]);

    // 4. yarn dev:inner with watchdog
    console.log("\n🚀  yarn dev");
    await runDev(messages);

    mockServer.close();
    console.log("\n✅ christie-dhd800 restart appears successful");
    process.exit(0);
  } catch (err) {
    console.error("\n❌", err.message || err);
    process.exit(1);
  }
})();
