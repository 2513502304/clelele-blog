import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.cloudflare-pages');
const assets = path.join(output, 'public');
// Validate the build target before copying: a Vercel build is not a Pages artifact.
await readFile(path.join(root, 'dist/_worker.js/index.js'));
await mkdir(output, { recursive: true });
// Remove only this script's generated assets so deleted build files cannot survive a redeploy.
await rm(assets, { recursive: true, force: true });
await cp(path.join(root, 'dist'), assets, { recursive: true, force: true });
const server = path.join(assets, '_worker.js');
await rename(path.join(server, 'index.js'), path.join(server, 'app.js'));
const wrapper = await readFile(path.join(root, 'cloudflare-preview.mjs'), 'utf8');
await writeFile(path.join(server, 'index.js'), wrapper.replace('./dist/_worker.js/index.js', './app.js'));
await writeFile(path.join(output, 'wrangler.jsonc'), JSON.stringify({
  name: 'clelele-blog-preview',
  pages_build_output_dir: './public',
  compatibility_date: '2026-11-08',
  compatibility_flags: ['nodejs_compat'],
}, null, 2));
console.log('Prepared read-only Pages preview in .cloudflare-pages/public');
