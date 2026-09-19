import { deflateSync } from 'node:zlib';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}
const shield = [[0.5, 0.08], [0.86, 0.22], [0.8, 0.65], [0.5, 0.92], [0.2, 0.65], [0.14, 0.22]] as const;
function inside(x: number, y: number): boolean {
  let result = false;
  for (let i = 0, j = shield.length - 1; i < shield.length; j = i++) {
    const a = shield[i]!; const b = shield[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
  }
  return result;
}
function distance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
}

/** Small code-native shield asset; generated at build time without an image dependency. */
export function createIcon(size: number): Buffer {
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4) / size; const py = (y + (sy + 0.5) / 4) / size;
      if (!inside(px, py)) continue;
      const check = Math.min(distance(px, py, 0.31, 0.49, 0.46, 0.64), distance(px, py, 0.46, 0.64, 0.7, 0.35)) < 0.047;
      const color = check ? [9, 27, 41, 255] : [68, 218, 186, 255];
      color.forEach((channel, index) => { sum[index] = sum[index]! + channel; });
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    const alpha = sum[3]! / 16;
    for (let c = 0; c < 3; c++) scanlines[offset + c] = alpha ? Math.round(sum[c]! * 255 / sum[3]!) : 0;
    scanlines[offset + 3] = Math.round(alpha);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}
