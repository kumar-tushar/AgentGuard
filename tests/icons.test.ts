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
  it.each([16, 32, 48, 128])('generates matching green/red Orbit Pointer icons at %d pixels with transparent cutouts', (size) => {
    const neutralPng = createIcon(size);
    const alertPng = createIcon(size, 'alert');
    expect(alertPng.readUInt32BE(16)).toBe(size);
    expect(alertPng.readUInt32BE(20)).toBe(size);
    const neutral = pixels(neutralPng);
    const alert = pixels(alertPng);
    expect(alert).toHaveLength(size * (size * 4 + 1));
    let redPixels = 0;
    let greenPixels = 0;
    let whitePixels = 0;
    let transparentPixels = 0;
    let antialiasedPixels = 0;
    let coverage = 0;
    const colors = new Set<string>();
    const occupied: { x: number; y: number }[] = [];
    for (let y = 0; y < size; y++) {
      expect(alert[y * (size * 4 + 1)]).toBe(0);
      for (let x = 0; x < size; x++) {
        const offset = y * (size * 4 + 1) + 1 + x * 4;
        expect(alert[offset + 3]).toBe(neutral[offset + 3]);
        coverage += alert[offset + 3]! / 255;
        if (alert[offset + 3] === 0) transparentPixels++;
        else {
          occupied.push({ x, y });
          if (alert[offset + 3]! < 255) antialiasedPixels++;
        }
        if (alert[offset + 3] === 255) {
          if (alert[offset]! > alert[offset + 1]! + 70 && alert[offset]! > alert[offset + 2]! + 70) redPixels++;
          if (neutral[offset + 1]! > neutral[offset]! + 60 && neutral[offset + 1]! > neutral[offset + 2]! + 30) greenPixels++;
          colors.add(alert.subarray(offset, offset + 3).toString('hex'));
        }
        if (alert.subarray(offset, offset + 4).equals(Buffer.from([255, 255, 255, 255]))) {
          whitePixels++;
          expect(neutral.subarray(offset, offset + 4)).toEqual(alert.subarray(offset, offset + 4));
        }
      }
    }
    // Small icons have proportionately more antialiased edges than large icons.
    expect(redPixels).toBeGreaterThan(size * size * 0.25);
    expect(greenPixels).toBe(redPixels);
    expect(whitePixels).toBe(0);
    expect(colors.size).toBeGreaterThan(12);
    expect(antialiasedPixels).toBeGreaterThan(size);
    expect(coverage).toBeGreaterThan(size * size * 0.4);
    expect(coverage).toBeLessThan(size * size * 0.5);
    // The ring center and cursor gap stay transparent; there is no background tile.
    expect(transparentPixels).toBeGreaterThan(size * size * 0.35);
    expect(transparentPixels).toBeLessThan(size * size * 0.65);
    expect(createIcon(size, 'neutral')).toEqual(neutralPng);
    expect(createIcon(size, 'alert')).toEqual(alertPng);

    const at = (data: Buffer, x: number, y: number): number[] => {
      const offset = Math.floor(y * size) * (size * 4 + 1) + 1 + Math.floor(x * size) * 4;
      return Array.from(data.subarray(offset, offset + 4));
    };
    // Keep the open orbit, inset cursor and separating gaps legible at every shipped size.
    for (const data of [neutral, alert]) {
      expect(at(data, 0, 0)).toEqual([0, 0, 0, 0]);
      expect(at(data, 1 - 1 / size, 0)).toEqual([0, 0, 0, 0]);
      expect(at(data, 0, 1 - 1 / size)).toEqual([0, 0, 0, 0]);
      expect(at(data, 1 - 1 / size, 1 - 1 / size)).toEqual([0, 0, 0, 0]);
      expect(at(data, 0.5, 0.5)).toEqual([0, 0, 0, 0]);
      expect(at(data, 0.84, 0.6)).toEqual([0, 0, 0, 0]);
      expect(at(data, 0.6, 0.82)).toEqual([0, 0, 0, 0]);
      for (const [x, y] of [[0.45, 0.08], [0.08, 0.45], [0.42, 0.9], [0.84, 0.32], [0.73, 0.72]] as const) {
        expect(at(data, x, y)[3]).toBe(255);
      }
    }

    // Maximize occupied bounds without clipping the antialiased outline.
    for (const axis of ['x', 'y'] as const) {
      expect(Math.min(...occupied.map(point => point[axis]))).toBeLessThanOrEqual(Math.ceil(size / 32));
      expect(Math.max(...occupied.map(point => point[axis]))).toBeGreaterThanOrEqual(size - 1 - Math.ceil(size / 32));
    }
  });
});
