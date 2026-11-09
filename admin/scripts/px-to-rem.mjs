// Rewrites pixel sizes in components and pages to rem, so the whole UI
// follows the root font size in globals.css. Hairlines (1px and less) stay.
// Run from admin/: node scripts/px-to-rem.mjs  (safe to run again)
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'components'];
const PX = /(?<![A-Za-z0-9.$])(\d+(?:\.\d+)?)px(?![A-Za-z0-9])/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(js|jsx)$/.test(name)) yield path;
  }
}

let changed = 0;
for (const root of ROOTS) {
  for (const path of files(root)) {
    const source = readFileSync(path, 'utf8');
    const next = source.replace(PX, (match, value) => {
      const px = Number(value);
      return px <= 1 ? match : `${Number((px / 16).toFixed(4))}rem`;
    });
    if (next !== source) {
      writeFileSync(path, next);
      changed++;
    }
  }
}
console.log(`${changed} files updated`);