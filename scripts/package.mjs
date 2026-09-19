import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('artifacts');
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(resolve('dist/manifest.json'), 'utf8'));
const archive = resolve(output, `agentguard-${manifest.version}.zip`);
// zip is available on macOS and the Linux CI image. Only packaged extension files are included.
execFileSync('zip', ['-q', '-X', '-r', '-FS', archive, '.'], { cwd: resolve('dist'), stdio: 'inherit' });
console.log(archive);
