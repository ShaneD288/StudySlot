// Draws the Studyslot app icons as PNGs with no dependencies. Run: node scripts/make-icons.js
import fs from "node:fs";
import zlib from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

// Studyslot icon: an ink-blue tile with a white timetable grid; one slot is highlighted yellow.
const INK_TOP = [56, 92, 232], INK_BOTTOM = [33, 60, 196];
const WHITE = [255, 255, 255], CELL = [214, 224, 255], YELLOW = [255, 225, 90];
const cols = 3, rows = 4, x0 = 0.2, y0 = 0.2, w = 0.6, hgt = 0.6, gapF = 0.035;
function colorAt(x, y) {
  const t = x * 0.35 + y * 0.65;
  let c = INK_TOP.map((v, i) => v + (INK_BOTTOM[i] - v) * t);
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + hgt) return c;
  const cw = w / cols, ch = hgt / rows;
  const cx = Math.floor((x - x0) / cw), cy = Math.floor((y - y0) / ch);
  const lx = (x - x0) - cx * cw, ly = (y - y0) - cy * ch;
  if (lx < gapF / 2 || lx > cw - gapF / 2 || ly < gapF / 2 || ly > ch - gapF / 2) return c;
  if (cy === 0) return WHITE;                       // header row
  if (cx === 1 && cy === 2) return YELLOW;          // the class happening now
  if ((cx + cy) % 3 === 0) return CELL;             // a few booked slots
  return [c[0] * 0.82 + 255 * 0.18, c[1] * 0.82 + 255 * 0.18, c[2] * 0.82 + 255 * 0.18];
}

function makeIcon(size) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const SS = 4;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const c = colorAt(x, y);
          acc = acc.map((v, i) => v + c[i]);
        }
      }
      const i = py * (size * 3 + 1) + 1 + px * 3;
      for (let k = 0; k < 3; k++) raw[i + k] = Math.round(acc[k] / (SS * SS));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [180, 192, 512]) {
  fs.writeFileSync(`public/icons/icon-${size}.png`, makeIcon(size));
  console.log(`public/icons/icon-${size}.png`);
}
