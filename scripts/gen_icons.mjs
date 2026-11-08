// Генератор иконок NyxLauncher: PNG (без библиотек) + ICO с PNG-внутри
// Логотип: полумесяц на тёмно-фиолетовом градиенте
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(size, pixels /* Uint8Array RGBA */) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.subarray(y * size * 4, (y + 1) * size * 4)
      .forEach((v, i) => { raw[y * (size * 4 + 1) + 1 + i] = v; });
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Полумесяц: круг радиуса R с вырезанным смещённым кругом
function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const R = size * 0.36;
  const R2 = size * 0.30; // вырез
  const cx2 = c + size * 0.16, cy2 = c - size * 0.12;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const t = y / size;
      // фон: фиолетовый ночной градиент
      let r = 26 + 34 * t, g = 18 + 22 * t, b = 52 + 60 * t, a = 255;
      const d1 = Math.hypot(x - c, y - c);
      const d2 = Math.hypot(x - cx2, y - cy2);
      if (d1 <= R && d2 > R2) {
        // луна: тёплый золотисто-белый
        const shade = 0.85 + 0.15 * (1 - d1 / R);
        r = 245 * shade; g = 226 * shade; b = 160 * shade;
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
    }
  }
  return px;
}

mkdirSync('src-tauri/icons', { recursive: true });

const png256 = png(256, draw(256));
writeFileSync('src-tauri/icons/icon.png', png256);
writeFileSync('src-tauri/icons/128x128@2x.png', png256);
writeFileSync('src-tauri/icons/128x128.png', png(128, draw(128)));
writeFileSync('src-tauri/icons/32x32.png', png(32, draw(32)));

// ICO: PNG-компрессия, допустимая для Vista+ (заголовок + 1 запись 256x256)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; // 0 = 256
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);  // planes
entry.writeUInt16LE(32, 6); // bit count
entry.writeUInt32LE(png256.length, 8); // размер данных
entry.writeUInt32LE(22, 12);           // оффсет данных (6 + 16)
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([header, entry, png256]));

console.log('OK: 4 PNG + ICO сгенерированы (полумесяц Nyx)');
