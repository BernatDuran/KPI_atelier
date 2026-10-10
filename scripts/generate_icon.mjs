import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

// CRC32 table
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  table[i] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function createPng(width, height, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // no interlace

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    const c = crc32(Buffer.concat([t, data]));
    crc.writeUInt32BE(c >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  }

  const raw = Buffer.alloc(height * (1 + width * 4));
  let pos = 0;
  for (let y = 0; y < height; y++) {
    raw[pos++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      raw[pos++] = r;
      raw[pos++] = g;
      raw[pos++] = b;
      raw[pos++] = a;
    }
  }

  const idat = zlib.deflateSync(raw);
  const end = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), end]);
}

export function getKpiAtelierIconPng() {
  return createPng(48, 48, (x, y, w, h) => {
    const pad = 3, rad = 9;
    const inCard = x >= pad && x < w - pad && y >= pad && y < h - pad;
    if (!inCard) return [0, 0, 0, 0];
    
    const dx = Math.min(x - pad, w - pad - 1 - x);
    const dy = Math.min(y - pad, h - pad - 1 - y);
    if (dx < rad && dy < rad) {
      const dist = Math.hypot(rad - dx, rad - dy);
      if (dist > rad) return [0, 0, 0, 0];
      if (dist > rad - 1.5) return [48, 66, 71, 255];
    }
    if (x === pad || x === w - pad - 1 || y === pad || y === h - pad - 1) {
      return [48, 66, 71, 255];
    }

    // Top dot (accent green #c3ec83)
    if (Math.hypot(x - 12, y - 13) <= 3) return [195, 236, 131, 255];
    // Title placeholder line (#a4b5b5)
    if (x >= 18 && x <= 36 && y >= 12 && y <= 14) return [164, 181, 181, 255];
    // Main KPI metric bold white block
    if (x >= 10 && x <= 28 && y >= 19 && y <= 24) return [255, 255, 255, 255];

    // Sparkline curve & subtle area fill
    if (x >= 10 && x <= 38) {
      const targetY = Math.round(38 - 10 * Math.sin((x - 10) / 4.5) - (x - 10) * 0.2);
      if (Math.abs(y - targetY) <= 1.2) return [195, 236, 131, 255];
      if (y > targetY && y <= 40) return [195, 236, 131, 60];
    }

    return [23, 39, 43, 255]; // Card background #17272b
  });
}

export function getKpiAtelierIconBase64() {
  return getKpiAtelierIconPng().toString('base64');
}

// Generate icon file if executed directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  const iconPath = path.resolve('dist/icon.png');
  fs.writeFileSync(iconPath, getKpiAtelierIconPng());
  console.log('Icon written to', iconPath);
}
