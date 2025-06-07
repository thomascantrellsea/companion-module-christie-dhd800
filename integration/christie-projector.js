// Utilities and tests for the Christie projector module
const fs = require("fs");
const net = require("net");
const http = require("http");
const { io } = require("socket.io-client");
const { extractColor, maybeSavePreview } = require("./util");

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

async function runProjectorTests(messages, port, setPower, savePreview) {
  // basic connectivity check with retries as the webui may still be starting
  async function checkRoot() {
    return new Promise((resolve) => {
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
  maybeSavePreview("preview_initial.png", previewImage, savePreview);
  const initial = previewImage;
  const initialColor = extractColor(initial);
  if (initialColor !== "#ff0000" && initialColor !== "#000000") {
    throw new Error(`unexpected initial color ${initialColor}`);
  }

  setPower("00");
  await httpPost(`/api/location/1/1/1/press`);
  await new Promise((r) => setTimeout(r, 45000));
  if (previewImage === initial) {
    throw new Error("preview did not change after state update");
  }
  maybeSavePreview("preview_updated.png", previewImage, savePreview);
  const newColor = extractColor(previewImage);
  if (newColor !== "#00ff00") {
    throw new Error(`unexpected updated color ${newColor}`);
  }
  await emitPromise("preview:location:unsubscribe", [location, subId]);

  socket.close();
}

module.exports = {
  startMockServer,
  startProxyServer,
  runProjectorTests,
};
