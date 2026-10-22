import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// electron-builder's pinned icon converter supports SVG -> ICNS, including
// 1024px Retina entries. No additional image or packaging dependency is needed.
const require = createRequire(import.meta.url);
const { convertIcon } = require('app-builder-lib/out/util/iconConverter.js');
const project = fileURLToPath(new URL('../', import.meta.url));

export async function generateMacIcon() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'md-macos-icon-'));
  try {
    const result = await convertIcon({ sources: [path.join(project, 'assets/icon.svg')], fallbackSources: [], roots: [project], format: 'icns', outDir: temporary });
    if (result.icons.length !== 1) throw new Error('Expected one generated macOS icon.');
    const data = await readFile(result.icons[0].file);
    if (data.toString('ascii', 0, 4) !== 'icns' || data.readUInt32BE(4) !== data.length) throw new Error('Invalid generated ICNS file.');
    const target = path.join(project, 'assets/icon.icns');
    await copyFile(result.icons[0].file, target);
    console.log(target);
    return target;
  } finally {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir())) throw new Error('Unexpected temporary icon path.');
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await generateMacIcon();
