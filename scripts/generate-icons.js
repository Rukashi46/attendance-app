const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal PNG encoder using built-in zlib
function crc32(buf) {
  let table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    table[n] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ (-1)) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(crcBuf), 0);
  return Buffer.concat([len, t, data, c]);
}

function encodePNG(width, height, rgbaBuffer) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  // Scanlines with filter byte 0
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    scanlines.writeUInt8(0, offset++);
    rgbaBuffer.copy(scanlines, offset, y * width * 4, (y + 1) * width * 4);
    offset += width * 4;
  }

  const compressed = zlib.deflateSync(scanlines);
  const idat = makeChunk('IDAT', compressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, makeChunk('IHDR', ihdr), idat, iend]);
}

// Distance from point (px, py) to line segment (ax, ay)-(bx, by)
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function renderIcon(size, isRound = false) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.46;
  const strokeWidth = size * 0.085;

  // Segment 1: from (0.30*size, 0.53*size) to (0.44*size, 0.67*size)
  const p1 = [size * 0.31, size * 0.54];
  const p2 = [size * 0.44, size * 0.67];
  // Segment 2: from (0.44*size, 0.67*size) to (0.69*size, 0.37*size)
  const p3 = [size * 0.70, size * 0.38];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let alphaMask = 0;

      if (isRound) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= radius) alphaMask = Math.min(1, radius - d + 0.5);
      } else {
        // Rounded rectangle
        const cornerR = size * 0.22;
        const qx = Math.abs(x + 0.5 - cx) - (cx - cornerR - 1);
        const qy = Math.abs(y + 0.5 - cy) - (cy - cornerR - 1);
        const dist = Math.hypot(Math.max(0, qx), Math.max(0, qy)) + Math.min(0, Math.max(qx, qy));
        if (dist <= cornerR) alphaMask = Math.min(1, cornerR - dist + 0.5);
      }

      if (alphaMask <= 0) {
        buf[idx] = 0; buf[idx + 1] = 0; buf[idx + 2] = 0; buf[idx + 3] = 0;
        continue;
      }

      // Base background color: #0f0f18
      let r = 16, g = 16, b = 24, a = 255;

      // Card border highlight
      if (isRound) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d >= radius - 2 && d <= radius) {
          r = 167; g = 139; b = 250;
        }
      }

      // Checkmark calculation
      const d1 = distToSegment(x + 0.5, y + 0.5, p1[0], p1[1], p2[0], p2[1]);
      const d2 = distToSegment(x + 0.5, y + 0.5, p2[0], p2[1], p3[0], p3[1]);
      const checkDist = Math.min(d1, d2);

      const halfStroke = strokeWidth / 2;
      if (checkDist <= halfStroke + 0.8) {
        const checkAlpha = Math.min(1, Math.max(0, (halfStroke + 0.8 - checkDist) / 1.2));
        // Gradient from violet (#a78bfa) to cyan (#67e8f9)
        const t = Math.max(0, Math.min(1, (x - p1[0]) / (p3[0] - p1[0])));
        const cr = Math.round(167 * (1 - t) + 103 * t);
        const cg = Math.round(139 * (1 - t) + 232 * t);
        const cb = Math.round(250 * (1 - t) + 249 * t);

        r = Math.round(r * (1 - checkAlpha) + cr * checkAlpha);
        g = Math.round(g * (1 - checkAlpha) + cg * checkAlpha);
        b = Math.round(b * (1 - checkAlpha) + cb * checkAlpha);
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = Math.round(a * alphaMask);
    }
  }

  return encodePNG(size, size, buf);
}

const resDir = path.join(__dirname, '../android/app/src/main/res');
const sizes = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

for (const [folder, sz] of Object.entries(sizes)) {
  const dir = path.join(resDir, folder);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const squarePng = renderIcon(sz, false);
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), squarePng);

  const roundPng = renderIcon(sz, true);
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), roundPng);

  console.log(`Generated ${folder} (${sz}x${sz})`);
}

console.log('All launcher icons generated successfully!');
