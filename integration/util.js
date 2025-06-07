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
  const rowLength = width * bytesPerPixel;
  const stride = rowLength + 1; // filter byte + row data
  const pixels = Buffer.alloc(rowLength * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  for (let y = 0; y < height; y++) {
    const filter = data[y * stride];
    const inRow = data.subarray(y * stride + 1, y * stride + 1 + rowLength);
    const outIndex = y * rowLength;
    switch (filter) {
      case 0: // None
        inRow.copy(pixels, outIndex);
        break;
      case 1: // Sub
        for (let x = 0; x < rowLength; x++) {
          const left =
            x >= bytesPerPixel ? pixels[outIndex + x - bytesPerPixel] : 0;
          pixels[outIndex + x] = (inRow[x] + left) & 0xff;
        }
        break;
      case 2: // Up
        for (let x = 0; x < rowLength; x++) {
          const up = y > 0 ? pixels[outIndex - rowLength + x] : 0;
          pixels[outIndex + x] = (inRow[x] + up) & 0xff;
        }
        break;
      case 3: // Average
        for (let x = 0; x < rowLength; x++) {
          const left =
            x >= bytesPerPixel ? pixels[outIndex + x - bytesPerPixel] : 0;
          const up = y > 0 ? pixels[outIndex - rowLength + x] : 0;
          pixels[outIndex + x] = (inRow[x] + ((left + up) >> 1)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let x = 0; x < rowLength; x++) {
          const left =
            x >= bytesPerPixel ? pixels[outIndex + x - bytesPerPixel] : 0;
          const up = y > 0 ? pixels[outIndex - rowLength + x] : 0;
          const upLeft =
            y > 0 && x >= bytesPerPixel
              ? pixels[outIndex - rowLength + x - bytesPerPixel]
              : 0;
          pixels[outIndex + x] = (inRow[x] + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        return null; // unknown filter
    }
  }

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);
  const idx = centerY * rowLength + centerX * bytesPerPixel;
  const r = pixels[idx];
  const g = pixels[idx + 1];
  const b = pixels[idx + 2];
  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}

module.exports = { extractColor };
