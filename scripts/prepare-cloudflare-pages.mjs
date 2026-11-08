import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.cloudflare-pages');
const assets = path.join(output, 'public');
const entry = await readFile(path.join(root, 'cloudflare/pages-entry.mjs'), 'utf8');
await mkdir(output, { recursive: true });
// Only this generated gateway directory is replaced; the container serves the blog's static assets.
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await writeFile(path.join(assets, '_worker.js'), entry);
await writeFile(path.join(assets, '_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
await writeFile(
  path.join(output, 'wrangler.jsonc'),
  JSON.stringify(
    {
      name: 'clelele-blog',
      pages_build_output_dir: './public',
      compatibility_date: '2026-11-08',
      compatibility_flags: ['nodejs_compat'],
      services: [{ binding: 'BLOG', service: 'clelele-blog-container', environment: 'production' }],
    },
    null,
    2,
  ),
);
console.log('Prepared production Pages service-binding gateway in .cloudflare-pages/public');
