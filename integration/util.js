const zlib = require("zlib");

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
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);
  const idx = y * stride + 1 + x * bytesPerPixel; // center pixel
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

module.exports = { extractColor };
