import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createManifest } from './src/manifest.ts';
import { createIcon } from './scripts/icons.ts';
import { installSensor } from './src/content/sensor.ts';

export default defineConfig({
  plugins: [react(), {
    name: 'agentguard-manifest',
    transformIndexHtml: {
      order: 'post',
      handler() {
        return [{ tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: './icons/icon-32.png' }, injectTo: 'head' }];
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.json', source: JSON.stringify(createManifest(), null, 2) });
      // Manifest content scripts are classic scripts, not shared ESM chunks.
      this.emitFile({ type: 'asset', fileName: 'sensor.js', source: `(${installSensor.toString()})();` });
      for (const size of [16, 32, 48, 128]) {
        this.emitFile({ type: 'asset', fileName: `icons/icon-${size}.png`, source: createIcon(size) });
        this.emitFile({ type: 'asset', fileName: `icons/icon-alert-${size}.png`, source: createIcon(size, 'alert') });
      }
    },
  }],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'chrome120',
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, 'popup.html'),
        options: resolve(import.meta.dirname, 'options.html'),
        blocked: resolve(import.meta.dirname, 'blocked.html'),
        background: resolve(import.meta.dirname, 'src/background/worker.ts'),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
});
