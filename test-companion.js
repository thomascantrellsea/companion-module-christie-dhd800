#!/usr/bin/env node
/**
 * setup-companion.js
 *
 * Automates local-development wiring for the Christie DHD800 Companion module.
 *
 *  Steps performed:
 *  1. cd externals/companion
 *  2. Ensure symlink: module-local-dev/companion-module-christie-dhd800 → ../../..
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

// ---------- helper: ensure symlink ----------
async function ensureSymlink() {
  const linkRel = path.join(
    "module-local-dev",
    "companion-module-christie-dhd800",
  );
  const linkTarget = path.join("..", "..", ".."); // ../../..

  try {
    const stats = await fsPromises.lstat(linkRel);
    if (!stats.isSymbolicLink()) {
      throw new Error(`${linkRel} exists but is not a symlink`);
    }
    const currentTarget = await fsPromises.readlink(linkRel);
    if (currentTarget !== linkTarget) {
      console.log(
        `Symlink points to "${currentTarget}" – recreating → "${linkTarget}"`,
      );
      await fsPromises.unlink(linkRel);
      await fsPromises.symlink(linkTarget, linkRel);
    } else {
      console.log("✔︎ Symlink already correct");
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      await fsPromises.mkdir(path.dirname(linkRel), { recursive: true });
      await fsPromises.symlink(linkTarget, linkRel);
      console.log(`✔︎ Symlink created ${linkRel} → ${linkTarget}`);
    } else {
      throw err;
    }
  }
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
      detached: true, // own process group for clean kill
    });
    let success = true;

    const watch = (data) => {
      const text = data.toString();
      process.stdout.write(text);
      // Very simple heuristics for error lines – tweak as required
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

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (success) {
        resolve();
      } else {
        reject(new Error("christie-dhd800 module did not start cleanly"));
      }
    });
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
    // 2. symlink
    await ensureSymlink();

    // 3. yarn install
    console.log("\n📦  yarn install");
    runSync("yarn", ["install"]);

    // 4. yarn dev:inner with watchdog
    console.log("\n🚀  yarn dev");
    await runDev();
    console.log("\n✅ christie-dhd800 restart appears successful");
    process.exit(0);
  } catch (err) {
    console.error("\n❌", err.message || err);
    process.exit(1);
  }
})();
