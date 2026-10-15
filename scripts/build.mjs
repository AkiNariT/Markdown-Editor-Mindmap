import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, outfile: 'dist/app.js', platform: 'browser', format: 'iife', target: 'chrome144', minify: true, legalComments: 'eof' });
await writeFile('dist/style.css', (await readFile('src/style.css', 'utf8')) + '\n' + (await readFile('src/mindmap.css', 'utf8')) + '\n' + (await readFile('src/mindmap-appearance.css', 'utf8')));
console.log('Built renderer');
