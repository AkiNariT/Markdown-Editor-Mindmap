import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['Third-party notices for MD\nElectron and Chromium notices are supplied separately in the portable runtime.\n'];
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev || metadata.devOptional) continue;
  let licenseText = '';
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'license.txt', 'LICENSE-MIT']) {
    try { licenseText = await readFile(path.join(location, name), 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!licenseText) throw new Error('Missing license text for ' + location);
  notices.push(`\n----- ${location.replace(/^node_modules\//, '')} ${metadata.version} -----\n${licenseText}\n`);
}
await writeFile('THIRD_PARTY_NOTICES.txt', notices.join('\n'), 'utf8');
