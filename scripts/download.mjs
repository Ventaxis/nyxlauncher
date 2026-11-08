// Simple downloader: node download.mjs <url> <outfile>
import { createWriteStream, existsSync, statSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const [url, out] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node download.mjs <url> <outfile>');
  process.exit(1);
}

const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) {
  console.error(`HTTP ${res.status} for ${url}`);
  process.exit(1);
}
if (existsSync(out)) unlinkSync(out);
await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
const size = statSync(out).size;
console.log(`OK: ${out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
