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
type Point = readonly [number, number];

function roundedOutline(points: readonly Point[], cuts: ReadonlyMap<number, number>): Point[] {
  return points.flatMap((point, index) => {
    const cut = cuts.get(index);
    if (!cut) return [point];
    const toward = (other: Point): Point => {
      const fraction = Math.min(0.5, cut / Math.hypot(other[0] - point[0], other[1] - point[1]));
      return [point[0] + (other[0] - point[0]) * fraction, point[1] + (other[1] - point[1]) * fraction];
    };
    const from = toward(points[(index + points.length - 1) % points.length]!);
    const to = toward(points[(index + 1) % points.length]!);
    return Array.from({ length: 9 }, (_, step): Point => {
      const t = step / 8; const s = 1 - t;
      return [s * s * from[0] + 2 * s * t * point[0] + t * t * to[0], s * s * from[1] + 2 * s * t * point[1] + t * t * to[1]];
    });
  });
}

// An open circular orbit and a separate inset cursor, not a filled background tile.
const arcSteps = 80;
const arc = (radius: number, reverse: boolean): Point[] => Array.from({ length: arcSteps + 1 }, (_, step) => {
  const angle = (12 - 292 * (reverse ? 1 - step / arcSteps : step / arcSteps)) * Math.PI / 180;
  return [0.488 + radius * Math.cos(angle), 0.488 + radius * Math.sin(angle)];
});
const orbit = roundedOutline([...arc(0.472, false), ...arc(0.278, true)], new Map([[0, 0.025], [arcSteps, 0.025], [arcSteps + 1, 0.025], [2 * arcSteps + 1, 0.025]]));
const pointer = roundedOutline([[0.565, 0.53], [0.985, 0.7], [0.825, 0.81], [0.715, 0.985]], new Map([[0, 0.04], [1, 0.028], [2, 0.012], [3, 0.026]]));

function inside(x: number, y: number, outline: readonly Point[]): boolean {
  let contained = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!; const b = outline[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) contained = !contained;
  }
  return contained;
}

/** Approved Orbit Pointer asset; generated at build time without an image dependency. */
export function createIcon(size: number, variant: 'neutral' | 'alert' = 'neutral'): Buffer {
  const scanlines = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4) / size; const py = (y + (sy + 0.5) / 4) / size;
      const cursor = inside(px, py, pointer);
      if (!cursor && !inside(px, py, orbit)) continue;
      const top = variant === 'alert' ? [255, 111, 98] : [63, 235, 167];
      const bottom = variant === 'alert' ? [229, 20, 54] : [0, 175, 134];
      // Broad, restrained facets retain the selected concept's depth even at toolbar size.
      const shade = cursor ? (py - 0.53) * 1.5 : Math.min(1, py + (py > 0.45 + px * 0.55 ? -0.18 : 0));
      const color = top.map((channel, index) => Math.round(channel + (bottom[index]! - channel) * shade));
      color.push(255);
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
