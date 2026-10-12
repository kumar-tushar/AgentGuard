import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createIcon } from '../scripts/icons';

function pixels(png: Buffer): Buffer {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const data: Buffer[] = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return inflateSync(Buffer.concat(data));
}

describe('code-native toolbar icons', () => {
  it.each([16, 32, 48, 128])('generates a red alert shield at %d pixels with the original shape and transparent background', (size) => {
    const neutralPng = createIcon(size);
    const alertPng = createIcon(size, 'alert');
    expect(alertPng.readUInt32BE(16)).toBe(size);
    expect(alertPng.readUInt32BE(20)).toBe(size);
    const neutral = pixels(neutralPng);
    const alert = pixels(alertPng);
    expect(alert).toHaveLength(size * (size * 4 + 1));
    let redPixels = 0;
    let transparentPixels = 0;
    for (let y = 0; y < size; y++) {
      expect(alert[y * (size * 4 + 1)]).toBe(0);
      for (let x = 0; x < size; x++) {
        const offset = y * (size * 4 + 1) + 1 + x * 4;
        expect(alert[offset + 3]).toBe(neutral[offset + 3]);
        if (alert[offset + 3] === 0) transparentPixels++;
        if (alert[offset] === 239 && alert[offset + 1] === 68 && alert[offset + 2] === 68 && alert[offset + 3] === 255) redPixels++;
      }
    }
    expect(redPixels).toBeGreaterThan(size);
    expect(transparentPixels).toBeGreaterThan(size);
    expect(createIcon(size, 'neutral')).toEqual(neutralPng);
  });
});
