// Utilities for launching Companion and interacting with it during tests
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const fsPromises = require("fs/promises");
const path = require("path");
const os = require("os");
const net = require("net");

let activeChild = null;

function installCleanupHandlers() {
  const cleanup = () => {
    if (activeChild) {
      console.log("\nCleaning up Companion process...");
      killProcessTree(activeChild);
    }
  };

  ["SIGINT", "SIGTERM"].forEach((sig) => {
    process.on(sig, () => {
      cleanup();
      process.exit(1);
    });
  });

  process.on("exit", cleanup);
}

function startDummyStoreServer() {
  const http = require("http");
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/v1/companion/modules/connection") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ modules: [] }));
      } else if (req.url.startsWith("/v1/companion/modules/connection/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

async function copyModuleFiles(repoRoot) {
  const destDir = path.join(
    "module-local-dev",
    "companion-module-christie-dhd800",
  );

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
    const dest = path.join(destDir, rel);
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });
    await fsPromises.copyFile(src, dest);
  }

  runSync("yarn", ["install"], { cwd: destDir });
  console.log(`✔︎ Files copied to ${destDir}`);
}

function runSync(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0)
    throw new Error(`${cmd} ${args.join(" ")} exited code ${res.status}`);
}

function killProcessTree(child) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", child.pid, "/T", "/F"]);
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (_) {}

  setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (_) {}
  }, 2000);
}

async function runDev(messages, setPower, keepRunning, runTests) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "companion-config-"));
  console.log("\uD83D\uDCC1  Using temp config dir", configDir);

  async function findFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
      srv.on("error", reject);
    });
  }

  const adminPort = keepRunning ? 8000 : await findFreePort();
  const extraArgs = keepRunning ? [] : ["--admin-port", String(adminPort)];

  return new Promise((resolve, reject) => {
    const proc = spawn(
      "yarn",
      ["dev:inner", "--config-dir", configDir, ...extraArgs],
      {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        env: { ...process.env },
      },
    );
    activeChild = proc;
    let success = true;
    let serverReady = false;

    const watch = (data) => {
      const text = data.toString();
      if (
        /ModuleStoreService.*fetch failed/.test(text) ||
        /fetch failed/i.test(text) ||
        /ENETUNREACH/.test(text)
      ) {
        return;
      }
      process.stdout.write(text);

      if (/new url:/i.test(text) && !serverReady) {
        serverReady = true;
        runTests(adminPort)
          .then(() => {
            if (!keepRunning) {
              killProcessTree(proc);
            } else {
              console.log(
                "Tests passed. Companion still running for debugging",
              );
            }
          })
          .catch((err) => {
            console.error("HTTP tests failed", err);
            success = false;
            if (!keepRunning) {
              killProcessTree(proc);
            } else {
              console.log(
                "Tests failed. Companion left running for post-mortem debugging",
              );
            }
          });
      }

      if (
        (/Error:/i.test(text) ||
          /ERR_/i.test(text) ||
          /Access to this API has been restricted/i.test(text)) &&
        !/Restart forced/i.test(text)
      ) {
        success = false;
      }
    };

    proc.stdout.on("data", watch);
    proc.stderr.on("data", watch);

    const timer = !keepRunning
      ? setTimeout(() => {
          console.log("\n⏰  5 minutes elapsed – terminating dev process");
          success = false;
          killProcessTree(proc);
        }, 300000)
      : null;

    proc.on("close", () => {
      if (timer) clearTimeout(timer);
      fs.rmSync(configDir, { recursive: true, force: true });
      activeChild = null;
      if (success) resolve();
      else reject(new Error("christie-dhd800 module did not start cleanly"));
    });
  });
}

module.exports = {
  installCleanupHandlers,
  startDummyStoreServer,
  copyModuleFiles,
  runDev,
  runSync,
  killProcessTree,
};
