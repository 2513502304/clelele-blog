import { fetchHpoiCollectionState } from '../../src/lib/hpoi/fetch';
import { readHpoiImageManifest } from '../../src/lib/hpoi/image-store';
import { syncHpoiImage } from '../../src/lib/hpoi/image-sync';

/** Resume-safe batch backfill. With no explicit IDs, discover every figure in the public collection. */
const args = process.argv.slice(2);
const userId = args.find((arg) => arg.startsWith('--user='))?.slice(7) ?? '783694';
const selected = args
  .find((arg) => arg.startsWith('--ids='))
  ?.slice(6)
  .split(',');
const ids = selected ?? (await fetchHpoiCollectionState(userId, 'all')).map((item) => item.id);
const manifest = await readHpoiImageManifest();
const missing = [...new Set(ids)].filter((id) => !manifest[id]);
console.log(JSON.stringify({ total: ids.length, cached: ids.length - missing.length, pending: missing.length }));
if (!args.includes('--dry-run')) {
  let failed = 0;
  let next = 0;
  // Bounded operator backfill; the production discovery queue remains a single worker.
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < missing.length) {
        const index = next++;
        const id = missing[index];
        try {
          const record = await syncHpoiImage(id);
          console.log(
            JSON.stringify({
              index: index + 1,
              total: missing.length,
              id,
              matched: record.matched,
              source: record.sourceUrl,
              pixels: [record.sourceWidth, record.sourceHeight],
              photos: record.candidates.length,
              best: [...record.candidates].sort((a, b) => b.similarity - a.similarity)[0],
            }),
          );
        } catch (error) {
          failed++;
          console.error(id, error instanceof Error ? error.message : 'Failed');
        }
      }
    }),
  );
  if (failed) process.exitCode = 1;
}
