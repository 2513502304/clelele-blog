/** Seed a fresh HF profile from an explicit local JSON manifest; never replace an edited profile. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { assetSlotSchema, profileFieldsSchema, type SiteProfile } from '../src/lib/site-profile/schema';
import { getSiteProfile, saveSiteProfile, uploadSiteAsset } from '../src/lib/site-profile/store';
import { configureEnvironmentProxy } from './lib/environment-proxy.mjs';

configureEnvironmentProxy();
const manifestPath = process.argv.find((arg) => arg.endsWith('.json'));
if (!manifestPath || process.argv.includes('--help')) {
  console.log(
    'Usage: node --env-file-if-exists=.env.local --import tsx scripts/migrate-site-profile.ts seed.json [--apply]\nSeed: { name, signature, links: [...], files: { avatar: "local.webp", home: "local.webp", weekly: "optional.webp" } }. Paths are relative to the seed file. Existing HF profiles are never overwritten.',
  );
  process.exit(0);
}
try {
  const existing = await getSiteProfile(true);
  console.log(`Profile already initialized (${existing.revision}); no writes.`);
  process.exit(0);
} catch (error) {
  if (!(error instanceof Error) || error.message !== 'Site profile has not been initialized.') throw error;
}
const input = profileFieldsSchema
  .extend({ files: z.record(assetSlotSchema, z.string().min(1)) })
  .parse(JSON.parse(await readFile(manifestPath, 'utf8')));
if (!input.files.avatar || !input.files.home) throw new Error('Avatar and home files are required.');
if (!process.argv.includes('--apply')) {
  console.log(`Plan: ${Object.keys(input.files).length} images and ${input.links.length} contacts. Add --apply to publish.`);
  process.exit(0);
}
const assets: SiteProfile['assets'] = {};
const history: SiteProfile['history'] = [];
for (const [slot, file] of Object.entries(input.files)) {
  const asset = await uploadSiteAsset(await readFile(path.resolve(path.dirname(manifestPath), file)), path.basename(file));
  assets[assetSlotSchema.parse(slot)] = asset.key;
  if (!history.some((entry) => entry.key === asset.key)) history.push(asset);
}
const { files: _, ...fields } = input;
const result = await saveSiteProfile(null, () => ({
  ...fields,
  version: 1,
  revision: randomUUID(),
  updatedAt: new Date().toISOString(),
  assets,
  history,
}));
if ((await getSiteProfile(true)).revision !== result.revision)
  throw new Error('HF readback did not match the published profile.');
console.log(
  `Published and verified ${result.history.length} assets, ${result.links.length} contacts; revision ${result.revision}.`,
);
