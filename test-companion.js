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
const os = require("os");
const net = require("net");
const zlib = require("zlib");

const keepRunning =
  process.argv.includes("--keep-running") || process.env.KEEP_RUNNING === "1";

let projectorIp = null;
const ipIndex = process.argv.indexOf("--projector-ip");
if (ipIndex !== -1 && process.argv[ipIndex + 1]) {
  projectorIp = process.argv[ipIndex + 1];
} else if (process.env.PROJECTOR_IP) {
  projectorIp = process.env.PROJECTOR_IP;
}

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

// ---------- helper: start mock tcp server ----------
function startMockServer() {
  const messages = [];
  let power = "80";
  let input = "1";
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let passReceived = false;
      socket.write("PASSWORD:\r");
      let buffer = "";
      socket.on("data", (d) => {
        buffer += d.toString();
        const parts = buffer.split("\r");
        buffer = parts.pop();
        for (const line of parts) {
          const msg = line.trim();
          if (msg) {
            messages.push(msg);
            console.log("mock server received:", msg);
          }
          if (!passReceived) {
            passReceived = true;
            socket.write("HELLO\r");
          } else if (msg === "CR0") {
            setImmediate(() => {
              console.log("mock server responded:", power);
              socket.write(power + "\r");
            });
          } else if (msg === "CR1") {
            setImmediate(() => {
              console.log("mock server responded:", input);
              socket.write(input + "\r");
            });
          }
        }
      });
    });
    server.listen(10000, "127.0.0.1", () =>
      resolve({
        server,
        messages,
        setPower: (v) => (power = v),
        setInput: (v) => (input = v),
      }),
    );
  });
}

function startProxyServer(targetHost) {
  const messages = [];
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      const target = net.connect(10000, targetHost);
      socket.pipe(target);
      target.pipe(socket);
      let buffer = "";
      socket.on("data", (d) => {
        buffer += d.toString();
        const parts = buffer.split("\r");
        buffer = parts.pop();
        for (const line of parts) {
          const msg = line.trim();
          if (!msg) continue;
          messages.push(msg);
          console.log("proxy forwarded:", msg);
        }
      });
    });
    server.listen(10000, "127.0.0.1", () => resolve({ server, messages }));
  });
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
    const dest = path.join(destDir, rel);
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });
    await fsPromises.copyFile(src, dest);
  }

  // install dependencies for the copied module
  runSync("yarn", ["install"], { cwd: destDir });

  console.log(`✔︎ Files copied to ${destDir}`);
}

// ---------- helper: run sync command ----------
function runSync(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
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

// ---------- helper: run yarn dev:inner with 5‑minute watchdog ----------
async function runDev(messages, setPower, keepRunning) {
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
        runHttpTests(messages, adminPort, setPower)
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
        }, 300_000)
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

async function runHttpTests(messages, port, setPower) {
  const http = require("http");
  const { io } = require("socket.io-client");

  // basic connectivity check with retries as the webui may still be starting
  async function checkRoot() {
    return new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}`, (res) => {
          const { statusCode } = res;
          res.resume();
          res.on("end", () => resolve(statusCode));
        })
        .on("error", () => resolve(null));
    });
  }

  let status = null;
  for (let i = 0; i < 40; i++) {
    status = await checkRoot();
    if (status === 200 || status === 404) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (status !== 200 && status !== 404) {
    throw new Error("unexpected http status " + status);
  }

  // helper to POST to companion
  async function httpPost(path) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { method: "POST", host: "127.0.0.1", port, path },
        (res) => {
          res.resume();
          res.on("end", resolve);
        },
      );
      req.on("error", reject);
      req.end();
    });
  }

  function extractColor(image) {
    if (!image) return null;
    const b64 = image.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buf.subarray(0, 8).equals(sig)) return null;
    let pos = 8;
    let width = 0;
    let height = 0;
    const idat = [];
    while (pos < buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
      pos += 8;
      if (type === "IHDR") {
        width = buf.readUInt32BE(pos);
        height = buf.readUInt32BE(pos + 4);
      } else if (type === "IDAT") {
        idat.push(buf.subarray(pos, pos + len));
      }
      pos += len + 4; // skip chunk data + crc
      if (type === "IEND") break;
    }
    if (width <= 0 || height <= 0 || idat.length === 0) return null;
    const data = zlib.inflateSync(Buffer.concat(idat));
    const bytesPerPixel = 4;
    const stride = width * bytesPerPixel + 1;
    const idx = 1 * stride + 1 * bytesPerPixel; // pixel (1,1) avoid border
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    return (
      "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0")
    );
  }

  const socket = io(`http://127.0.0.1:${port}`, { transports: ["websocket"] });
  await new Promise((resolve) => socket.on("connect", resolve));

  function emitPromise(event, args) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 10000);
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

  // Wait for the module to publish its action definitions
  let defs = null;
  for (let i = 0; i < 400; i++) {
    try {
      defs = await emitPromise("entity-definitions:subscribe", ["action"]);
    } catch (_) {
      defs = null;
    }
    if (defs?.[connectionId]) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!defs?.[connectionId]) {
    throw new Error("action definitions failed to load");
  }

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

    const added = await emitPromise("controls:entity:add", [
      controlId,
      { stepId: "0", setId: "down" },
      null,
      connectionId,
      "action",
      actionId,
    ]);
    if (!added) {
      throw new Error(`failed to add action ${actionId}`);
    }

    const before = messages.length;
    await httpPost(`/api/location/1/1/1/press`);
    await new Promise((r) => setTimeout(r, 2000));
    const msg = messages.slice(before).join("\n");
    if (!msg.includes(cmd)) {
      throw new Error(`Expected command ${cmd} not seen for ${actionId}`);
    }
  }

  // feedback rendering test
  await emitPromise("controls:reset", [location, "button"]);
  const pages2 = await emitPromise("pages:subscribe", []);
  const pageId2 = pages2.order[0];
  const controlId2 =
    pages2.pages[pageId2]?.controls?.[location.row]?.[location.column];
  if (!controlId2) throw new Error("control not found");

  await emitPromise("controls:set-style-fields", [
    controlId2,
    { bgcolor: 0xff0000 },
  ]);

  // Wait to ensure the style update has propagated before reading the preview
  await new Promise((r) => setTimeout(r, 500));

  const fbAdded = await emitPromise("controls:entity:add", [
    controlId2,
    "feedbacks",
    null,
    connectionId,
    "feedback",
    "power_state",
  ]);
  if (!fbAdded) throw new Error("failed to add feedback");
  await emitPromise("controls:entity:set-option", [
    controlId2,
    "feedbacks",
    fbAdded,
    "state",
    "00",
  ]);

  let previewImage = null;
  socket.on("preview:location:render", (loc, img) => {
    if (
      loc.pageNumber === location.pageNumber &&
      loc.row === location.row &&
      loc.column === location.column
    ) {
      previewImage = img;
    }
  });
  const subId = "testsub";
  const initPrev = await emitPromise("preview:location:subscribe", [
    location,
    subId,
  ]);
  previewImage = initPrev.image;

  if (!previewImage) throw new Error("initial preview missing");
  const initial = previewImage;
  const initialColor = extractColor(initial);
  if (initialColor !== "#ff0000" && initialColor !== "#000000") {
    throw new Error(`unexpected initial color ${initialColor}`);
  }

  setPower("00");
  await httpPost(`/api/location/1/1/1/press`);
  await new Promise((r) => setTimeout(r, 75000));
  if (previewImage === initial) {
    throw new Error("preview did not change after state update");
  }
  const newColor = extractColor(previewImage);
  if (newColor !== "#00ff00") {
    throw new Error(`unexpected updated color ${newColor}`);
  }
  await emitPromise("preview:location:unsubscribe", [location, subId]);

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

    // 2. copy module files
    await copyModuleFiles(repoRoot);

    const { server: storeServer, port: storePort } =
      await startDummyStoreServer();
    process.env.STAGING_MODULE_API = `http://127.0.0.1:${storePort}`;

    // 3. yarn install
    console.log("\n📦  yarn install");
    runSync("yarn", ["install"]);

    // 4. yarn dev:inner with watchdog
    console.log("\n🚀  yarn dev");
    if (keepRunning) {
      console.log(
        "ℹ️  keep-running mode enabled – Companion will stay running on failure",
      );
    }
    await runDev(messages, setPower, keepRunning);
    storeServer.close();

    mockServer.close();
    console.log("\n✅ christie-dhd800 restart appears successful");
    process.exit(0);
  } catch (err) {
    console.error("\n❌", err.message || err);
    process.exit(1);
  }
})();
