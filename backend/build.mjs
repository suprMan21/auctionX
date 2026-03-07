import esbuild from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function getEntryPoints(dir) {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true });
  return files
    .filter(f => f.isFile() && f.name.endsWith('.ts') && !f.name.endsWith('.test.ts') && !f.name.endsWith('.spec.ts'))
    .map(f => join(f.parentPath || f.path, f.name));
}

const entryPoints = getEntryPoints('src');

await esbuild.build({
  entryPoints,
  outdir: 'dist',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  bundle: false,
});

console.log(`Built ${entryPoints.length} files to dist/`);
