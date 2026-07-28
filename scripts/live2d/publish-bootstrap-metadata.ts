import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHfS3Client } from '../../src/lib/hf-s3';
import { assertLive2DManifestReleaseId } from '../../src/lib/live2d/package-manifest';
import { live2dCatalogSchema, live2dPackageManifestSchema, live2dProvenanceSchema } from '../../src/lib/live2d/types';
import { getPublisherConfig, publishImmutableJson, updateRemoteCatalog } from './publish-models';

const repoRoot = path.resolve(import.meta.dirname, '../..');

/**
 * 将仓库内四套 bootstrap 元数据发布到 HF。它们继续留在 bundle 中作为冷启动回退，
 * 后续新增模型只进入 HF，不再要求为每套服装增加 Git 文件。
 */
async function main(): Promise<void> {
  const catalogPath = path.join(repoRoot, 'src/data/live2d/catalog.json');
  const catalog = live2dCatalogSchema.parse(JSON.parse(await readFile(catalogPath, 'utf8')));
  const client = createHfS3Client(getPublisherConfig(), {
    attempts: 5,
    transferTimeoutMs: 120_000,
  });

  for (const character of catalog.characters) {
    for (const sourceCostume of character.costumes) {
      const manifestPath = path.join(repoRoot, 'src/data/live2d/manifests', `${sourceCostume.releaseId}.json`);
      const provenancePath = path.join(repoRoot, 'src/data/live2d/provenance', `${sourceCostume.releaseId}.json`);
      const manifestText = await readFile(manifestPath, 'utf8');
      const provenanceText = await readFile(provenancePath, 'utf8');
      const manifest = live2dPackageManifestSchema.parse(JSON.parse(manifestText));
      const provenance = live2dProvenanceSchema.parse(JSON.parse(provenanceText));
      assertLive2DManifestReleaseId(manifest);
      if (manifest.releaseId !== sourceCostume.releaseId || provenance.releaseId !== sourceCostume.releaseId) {
        throw new Error(`Bootstrap metadata release mismatch for ${character.id}/${sourceCostume.id}.`);
      }

      await publishImmutableJson(client, `manifests/${manifest.releaseId}.json`, manifestText);
      await publishImmutableJson(client, `provenance/${provenance.releaseId}.json`, provenanceText);
      await updateRemoteCatalog(
        client,
        {
          characterId: character.id,
          characterLabels: character.label,
          replace: true,
        },
        {
          ...sourceCostume,
          provenancePath: `provenance/${sourceCostume.releaseId}.json`,
        },
      );
      console.log(`Published bootstrap metadata: ${character.id}/${sourceCostume.id}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

// LIVE2D_HF_S3_WRITE_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile hf) LIVE2D_HF_S3_WRITE_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile hf) npm exec --yes --package=node@24 --package=tsx -- tsx scripts/live2d/publish-bootstrap-metadata.ts
