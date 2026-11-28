import { createHash, randomUUID } from 'node:crypto';
import { createHfS3Client, HfS3ConflictError } from '../hf-s3';
import { type HpoiPurchaseStore, hpoiPurchaseStoreSchema, hpoiRecordId } from './purchases-schema';

/** Never reuse the public Gallery bucket: an explicit, independently verified private bucket is mandatory. */
export function hpoiPurchaseStorage() {
  const accessKeyId = process.env.HF_S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HF_S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.HF_S3_ENDPOINT;
  const bucket = process.env.HPOI_PURCHASES_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) throw new Error('Private purchase storage is not configured.');
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket === 'raw-datasets' ||
    bucket === process.env.HF_S3_BUCKET?.trim()
  )
    throw new Error('Purchase storage must use a separate private bucket.');
  const storageEndpoint = new URL(endpoint);
  if (
    storageEndpoint.protocol !== 'https:' ||
    storageEndpoint.username ||
    storageEndpoint.password ||
    storageEndpoint.search ||
    storageEndpoint.hash
  )
    throw new Error('Invalid private purchase storage endpoint.');
  return createHfS3Client(
    {
      accessKeyId,
      secretAccessKey,
      endpoint: storageEndpoint,
      bucket,
      prefix: 'hpoi-private-purchases',
      region: process.env.HF_S3_REGION ?? 'us-east-1',
    },
    { attempts: 1, requestTimeoutMs: 8_000, transferTimeoutMs: 8_000 },
  );
}

type Storage = Pick<ReturnType<typeof createHfS3Client>, 'get' | 'put'>;

/** Account-scoped CAS storage. No signed URL or private object key is returned by the owner API. */
export function createHpoiPurchaseStore(sourceUserId: string, storage: Storage = hpoiPurchaseStorage()) {
  hpoiRecordId.parse(sourceUserId);
  const key = `${createHash('sha256').update(`hpoi-owner-purchases-v1:${sourceUserId}`).digest('hex')}.json`;
  async function read() {
    const object = await storage.get(key);
    if (!object) return null;
    if (!object.etag || object.bytes.byteLength > 8_000_000) throw new Error('Invalid private purchase checkpoint.');
    const value = hpoiPurchaseStoreSchema.parse(JSON.parse(new TextDecoder().decode(object.bytes)));
    if (value.sourceUserId !== sourceUserId) throw new Error('Private purchase account mismatch.');
    return { value, etag: object.etag };
  }
  return {
    read,
    /** Never replay upstream reads after CAS conflicts; only this bookkeeping mutation is retried. */
    async edit(mutate: (current: HpoiPurchaseStore | null) => HpoiPurchaseStore | null) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const current = await read();
        const mutated = mutate(current?.value ?? null);
        if (!mutated) return current?.value ?? null;
        const next = hpoiPurchaseStoreSchema.parse({ ...mutated, revision: randomUUID() });
        if (next.sourceUserId !== sourceUserId) throw new Error('Private purchase account mismatch.');
        const bytes = Buffer.from(JSON.stringify(next));
        if (bytes.byteLength > 8_000_000) throw new Error('Private purchase checkpoint exceeds the size limit.');
        try {
          await storage.put(key, bytes, 'application/json', current ? { ifMatch: current.etag } : { ifNoneMatch: '*' });
          return next;
        } catch (error) {
          // A lost acknowledgement must be read back before deciding whether the checkpoint failed.
          const observed = await read();
          if (observed?.value.revision === next.revision) return observed.value;
          if (!(error instanceof HfS3ConflictError) || attempt === 3) throw error;
        }
      }
      throw new Error('Private purchase checkpoint conflict.');
    },
  };
}

export type HpoiPurchaseStorage = ReturnType<typeof createHpoiPurchaseStore>;
