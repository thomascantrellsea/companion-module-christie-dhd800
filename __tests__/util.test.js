const fs = require("fs");
const path = require("path");
const { extractColor } = require("../integration/util");

describe("extractColor", () => {
  function load(name) {
    const p = path.join(__dirname, "../integration/test-images", name);
    const img = fs.readFileSync(p);
    return "data:image/png;base64," + img.toString("base64");
  }

  test("extracts green from preview_green.png", () => {
    const dataUri = load("preview_green.png");
    expect(extractColor(dataUri)).toBe("#00ff00");
  });

  test("extracts red from preview_red.png", () => {
    const dataUri = load("preview_red.png");
    expect(extractColor(dataUri)).toBe("#ff0000");
  });
});
