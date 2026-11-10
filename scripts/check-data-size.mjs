import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const limit = 20_000_000;
const files = [];
async function scan(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await scan(file);
    else if (entry.name.endsWith('.json')) files.push({ file, bytes: (await stat(file)).size });
  }
}
await scan(new URL('../src', import.meta.url).pathname);
await scan(new URL('../public', import.meta.url).pathname);
const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
console.log(`Repository JSON: ${bytes.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')} bytes (${files.length} files)`);
if (bytes > limit) {
  console.error('Dataset exceeds the 20 MB repository budget. Reduce captures or records before deploying.');
  process.exitCode = 1;
}
