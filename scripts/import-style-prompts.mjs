#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import matter from 'gray-matter';
import sharp from 'sharp';

const PLACEHOLDER = '[在此处替换为您想要生成的主体内容]';
const DEFAULT_TARGETS = ['GPT-Image2', 'Nano Banana', 'Midjourney', 'Flux'];
const HF_S3_PROFILE = process.env.STYLE_GALLERY_S3_PROFILE ?? 'hf';
const HF_S3_ENDPOINT = process.env.HF_S3_ENDPOINT ?? 'https://s3.hf.co/clelele0722';
const HF_BUCKET_NAMESPACE = new URL(HF_S3_ENDPOINT).pathname.replace(/^\/+|\/+$/g, '');
const HF_S3_BUCKET = process.env.HF_S3_BUCKET ?? 'raw-datasets';
const HF_S3_PREFIX = (process.env.STYLE_GALLERY_BUCKET_PREFIX ?? 'image-style-prompt-gallery').replace(/^\/+|\/+$/g, '');
const HF_BUCKET_URI = `hf://buckets/${[HF_BUCKET_NAMESPACE, HF_S3_BUCKET, HF_S3_PREFIX].filter(Boolean).join('/')}`;

function usage() {
  console.error('Usage: node scripts/import-style-prompts.mjs <codex-session.jsonl> [--metadata-only]');
  console.error('       node scripts/import-style-prompts.mjs <codex-session.jsonl> [--update-metadata-only]');
}

function parseArgs(argv) {
  const flags = new Set();
  let sessionPath = null;

  for (const arg of argv) {
    if (arg === '-h' || arg.startsWith('--')) {
      flags.add(arg);
    } else if (!sessionPath) {
      sessionPath = arg;
    }
  }

  if (flags.has('--help') || flags.has('-h')) return { help: true, sessionPath, metadataOnly: false };

  const metadataOnly = flags.has('--metadata-only') || flags.has('--update-metadata-only');
  return { help: false, sessionPath, metadataOnly };
}

function parseDataUri(uri) {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(uri);
  if (!match) return null;
  const [, mime, data] = match;
  const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'bin';
  return { mime, data, ext };
}

function safePromptSummary(prompt) {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 140);
}

function sanitizeOriginalPrompt(prompt) {
  return prompt
    .replace(/\[\$([^\]\s]+)\]\((?:file:\/\/)?(?:~|\/Users|\/home)[^)]*\/SKILL\.md\)/g, '/$1')
    .replace(/(?:file:\/\/)?(?:~|\/Users|\/home)\/[^\s)]+\/([^/\s)]+)\/SKILL\.md/g, '/$1')
    .trim();
}

function itemHashFromImageHashes(imageHashes) {
  if (imageHashes.length === 1) return imageHashes[0];
  return crypto.createHash('sha256').update(imageHashes.join('\n')).digest('hex');
}

async function writeThumbnail(bytes, thumbnailPath) {
  await sharp(bytes).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 82 }).toFile(thumbnailPath);
}

function s3Uri(kind, fileName = '') {
  return `s3://${HF_S3_BUCKET}/${HF_S3_PREFIX}/${kind}/${fileName}`;
}

function apiImagePath(kind, fileName) {
  return `/api/style-gallery/image/${kind}/${fileName}`;
}

function importCommandComment(absoluteSessionPath, metadataOnly) {
  const sessionName = path.basename(absoluteSessionPath);
  const metadataFlag = metadataOnly ? ' --metadata-only' : '';
  return [
    `// script: node scripts/import-style-prompts.mjs /path/to/${sessionName}${metadataFlag}`,
    `// npm run import:style-prompts -- /path/to/${sessionName}${metadataFlag}`,
  ].join('\n');
}

function s5cmdArgs(...args) {
  return ['--profile', HF_S3_PROFILE, '--endpoint-url', HF_S3_ENDPOINT, ...args];
}

function listRemoteSourceFiles() {
  try {
    const output = execFileSync('s5cmd', s5cmdArgs('ls', s3Uri('source')), { encoding: 'utf8' });
    return new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/).at(-1))
        .filter(Boolean)
        .map((remotePath) => path.basename(remotePath)),
    );
  } catch (error) {
    if (error.stdout || error.stderr) {
      const message = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      if (message.includes('no object found')) return new Set();
    }
    throw error;
  }
}

function uploadToBucket(localPath, kind, fileName) {
  const target = s3Uri(kind, fileName);
  try {
    execFileSync('s5cmd', s5cmdArgs('cp', localPath, target), { stdio: 'inherit' });
  } catch (error) {
    if (kind !== 'source') throw error;
    execFileSync('aws', ['--profile', HF_S3_PROFILE, '--endpoint-url', HF_S3_ENDPOINT, 's3', 'cp', localPath, target], {
      stdio: 'inherit',
    });
  }
}

function frontmatter(data) {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      if (value.includes('\n')) {
        lines.push(`${key}: |-`);
        lines.push(...value.split('\n').map((line) => `  ${line}`));
      } else {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      lines.push(`${key}: ${value}`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
      } else if (value.every((item) => typeof item === 'string')) {
        lines.push(`${key}: [${value.map((item) => JSON.stringify(item)).join(', ')}]`);
      } else {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      }
    } else if (value instanceof Date) {
      lines.push(`${key}: ${JSON.stringify(value.toISOString())}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function itemBody(data, importComment) {
  return [
    '---',
    frontmatter(data).trimEnd(),
    '---',
    '',
    'Imported from a Codex session history by `scripts/import-style-prompts.mjs`.',
    importComment,
  ].join('\n');
}

async function readRecords(sessionPath) {
  const text = await fs.readFile(sessionPath, 'utf8');
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return { index: index + 1, record: JSON.parse(line) };
      } catch (error) {
        throw new Error(`Failed to parse JSONL line ${index + 1}: ${error.message}`);
      }
    });
}

function extractItems(records) {
  const items = [];
  let pendingInput = null;

  for (const { index, record } of records) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;

    if (record.type === 'event_msg' && payload.type === 'user_message' && Array.isArray(payload.images)) {
      const images = payload.images.filter((value) => typeof value === 'string' && value.startsWith('data:image/'));
      if (images.length > 0) {
        const message = typeof payload.message === 'string' ? payload.message : '';
        pendingInput = {
          images,
          originalPrompt: sanitizeOriginalPrompt(message),
          timestamp: record.timestamp,
          sourceLine: index,
        };
      }
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'agent_message') {
      const message = typeof payload.message === 'string' ? payload.message : payload.message?.content;
      if (pendingInput && typeof message === 'string' && message.includes(PLACEHOLDER)) {
        items.push({
          ...pendingInput,
          prompt: message.trim(),
          promptLine: index,
        });
        pendingInput = null;
      }
    }
  }

  return items;
}

async function getExistingItems(contentDir) {
  const items = new Map();
  let files = [];
  try {
    files = await fs.readdir(contentDir);
  } catch (error) {
    if (error.code === 'ENOENT') return items;
    throw error;
  }

  await Promise.all(
    files
      .filter((file) => /\.(md|mdx)$/.test(file))
      .map(async (file) => {
        const filePath = path.join(contentDir, file);
        const parsed = matter(await fs.readFile(filePath, 'utf8'));
        const imageHashes = Array.isArray(parsed.data.images)
          ? parsed.data.images.map((image) => image?.imageHash).filter(Boolean)
          : [parsed.data.imageHash].filter(Boolean);
        if (imageHashes.length > 0) {
          items.set(itemHashFromImageHashes(imageHashes), { filePath, data: parsed.data });
        }
      }),
  );

  return items;
}

async function updateExistingItemMetadata(existingItem, metadata, importComment) {
  const data = {
    ...existingItem.data,
    originalPrompt: metadata.originalPrompt || existingItem.data.originalPrompt,
    sourceSession: metadata.sourceSession,
    sourceLine: metadata.sourceLine,
  };

  await fs.writeFile(existingItem.filePath, `${itemBody(data, importComment)}\n`, 'utf8');
}

async function main() {
  const { help, sessionPath, metadataOnly } = parseArgs(process.argv.slice(2));
  if (help || !sessionPath) {
    usage();
    process.exit(help ? 0 : 1);
  }

  const root = process.cwd();
  const absoluteSessionPath = path.resolve(sessionPath);
  const importComment = importCommandComment(absoluteSessionPath, metadataOnly);
  const contentDir = path.join(root, 'src/content/styleGallery');
  await fs.mkdir(contentDir, { recursive: true });

  const records = await readRecords(absoluteSessionPath);
  const items = extractItems(records);
  const seenRemoteSourceFiles = metadataOnly ? new Set() : listRemoteSourceFiles();
  const seenSourceFiles = new Set(seenRemoteSourceFiles);
  const existingItems = await getExistingItems(contentDir);
  const duplicateHashes = new Set();
  let written = 0;
  let existingMatched = 0;
  let metadataUpdated = 0;
  let metadataMissing = 0;
  let skippedDuplicate = 0;
  let uploadedFiles = 0;

  for (const item of items) {
    const assets = [];
    for (const image of item.images) {
      const parsed = parseDataUri(image);
      if (!parsed) continue;

      const bytes = Buffer.from(parsed.data, 'base64');
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      const shortHash = hash.slice(0, 12);
      const imageName = `${shortHash}.${parsed.ext}`;
      const thumbnailName = `${shortHash}.webp`;
      assets.push({ bytes, hash, shortHash, imageName, thumbnailName });
    }

    if (assets.length === 0) continue;

    const imageHashes = assets.map((asset) => asset.hash);
    const itemHash = itemHashFromImageHashes(imageHashes);
    const itemShortHash = itemHash.slice(0, 12);
    const existingItem = existingItems.get(itemHash);

    if (existingItem) {
      duplicateHashes.add(itemHash);
      existingMatched += 1;
      if (metadataOnly) {
        await updateExistingItemMetadata(
          existingItem,
          {
            originalPrompt: item.originalPrompt,
            sourceSession: path.basename(absoluteSessionPath),
            sourceLine: item.sourceLine,
          },
          importComment,
        );
        metadataUpdated += 1;
      }
      skippedDuplicate += 1;
      continue;
    }

    if (metadataOnly) {
      metadataMissing += 1;
      continue;
    }

    for (const asset of assets) {
      if (seenSourceFiles.has(asset.imageName)) continue;

      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'style-gallery-import-'));
      const imagePath = path.join(tempDir, asset.imageName);
      const thumbnailPath = path.join(tempDir, asset.thumbnailName);
      await fs.writeFile(imagePath, asset.bytes);
      await writeThumbnail(asset.bytes, thumbnailPath);
      uploadToBucket(imagePath, 'source', asset.imageName);
      uploadToBucket(thumbnailPath, 'thumb', asset.thumbnailName);
      uploadedFiles += 2;
      seenSourceFiles.add(asset.imageName);
      await fs.rm(tempDir, { recursive: true, force: true });
    }

    const date = item.timestamp ? new Date(item.timestamp) : new Date();
    const datePrefix = date.toISOString().slice(0, 10);
    const slug = `${datePrefix}-${itemShortHash}`;
    const title = `Style Prompt ${itemShortHash}`;
    const imageRefs = assets.map((asset, index) => ({
      sourceImage: apiImagePath('source', asset.imageName),
      thumbnailImage: apiImagePath('thumb', asset.thumbnailName),
      sourceImageAlt: `${title} reference image ${index + 1}`,
      imageHash: asset.hash,
    }));
    const data = {
      title,
      description: safePromptSummary(item.prompt),
      date: date.toISOString(),
      sourceImage: imageRefs[0].sourceImage,
      thumbnailImage: imageRefs[0].thumbnailImage,
      sourceImageAlt: imageRefs[0].sourceImageAlt,
      prompt: item.prompt,
      originalPrompt: item.originalPrompt,
      imageHash: itemHash,
      images: imageRefs,
      sourceSession: path.basename(absoluteSessionPath),
      sourceLine: item.sourceLine,
      tags: ['codex-session', 'style-prompt'],
      modelTargets: DEFAULT_TARGETS,
      examples: [],
    };

    await fs.writeFile(path.join(contentDir, `${slug}.md`), `${itemBody(data, importComment)}\n`, 'utf8');
    existingItems.set(itemHash, { filePath: path.join(contentDir, `${slug}.md`), data });
    written += 1;
  }

  console.log(`Found ${items.length} image/prompt items.`);
  console.log(`Wrote ${written} unique gallery items.`);
  if (metadataOnly) {
    console.log(`Matched ${existingMatched} existing gallery items.`);
    console.log(`Updated metadata for ${metadataUpdated} existing gallery items.`);
    console.log(`Skipped ${metadataMissing} new image/prompt records because --metadata-only was set.`);
  } else {
    console.log(`Uploaded ${uploadedFiles} files to ${HF_BUCKET_URI}.`);
    if (skippedDuplicate > 0) {
      console.log(
        `Skipped ${skippedDuplicate} duplicate image/prompt records (${duplicateHashes.size} unique image groups already in the gallery).`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
