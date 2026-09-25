import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { StyleGalleryCatalogItem } from '@/types/style-gallery';
import { parseStyleGalleryExampleUploadArgs, resolveStyleGalleryUploadTarget } from './style-gallery-cli-example-upload';

function catalogItem(slug: string, imageHash: string): StyleGalleryCatalogItem {
  return {
    slug,
    title: `Style Prompt ${imageHash.slice(0, 12)}`,
    date: '2026-07-26T00:00:00.000Z',
    sourceImage: `/api/style-gallery/image/source/${imageHash.slice(0, 12)}.jpg`,
    promptExcerpt: 'Reusable prompt',
    promptCount: 1,
    promptRevision: 'c'.repeat(64),
    imageHash,
    imageCount: 1,
    exampleCount: 0,
  };
}

describe('style gallery example upload CLI', () => {
  it('parses aliases, tuning options, and multiple image paths', () => {
    const options = parseStyleGalleryExampleUploadArgs(
      [
        '-i',
        '2a256d37220e',
        '-p',
        'PixAI',
        '-n',
        'seed 42',
        '--concurrency',
        '8',
        '--attempts',
        '5',
        '--timeout-ms',
        '90000',
        './first.webp',
        './second.png',
      ],
      { STYLE_GALLERY_API_BASE_URL: 'http://127.0.0.1:4324/' },
    );

    assert.equal(options.apiBaseUrl, 'http://127.0.0.1:4324');
    assert.equal(options.itemSelector, '2a256d37220e');
    assert.equal(options.platform.label, 'PixAI');
    assert.equal(options.note, 'seed 42');
    assert.equal(options.concurrency, 8);
    assert.equal(options.attempts, 5);
    assert.equal(options.timeoutMs, 90_000);
    assert.equal(options.filePaths.length, 2);
  });

  it('resolves a target by slug, full hash, or unique short image ID', () => {
    const first = catalogItem('2026-07-26-2a256d37220e', `2a256d37220e${'a'.repeat(52)}`);
    const second = catalogItem('2026-07-26-bbbbbbbbbbbb', 'b'.repeat(64));
    const items = [first, second];

    assert.equal(resolveStyleGalleryUploadTarget(items, first.slug), first);
    assert.equal(resolveStyleGalleryUploadTarget(items, first.imageHash), first);
    assert.equal(resolveStyleGalleryUploadTarget(items, '2a256d37220e'), first);
    assert.throws(() => resolveStyleGalleryUploadTarget(items, 'cccccc'), /No style gallery item/);
  });

  it('rejects ambiguous short hashes and invalid required options', () => {
    const items = [
      catalogItem('2026-07-26-aaaaaa111111', `aaaaaa${'1'.repeat(58)}`),
      catalogItem('2026-07-26-aaaaaa222222', `aaaaaa${'2'.repeat(58)}`),
    ];

    assert.throws(() => resolveStyleGalleryUploadTarget(items, 'aaaaaa'), /ambiguous/);
    assert.throws(() => parseStyleGalleryExampleUploadArgs(['--item', 'aaaaaa', './image.webp']), /--platform/);
    assert.throws(() => parseStyleGalleryExampleUploadArgs(['--platform', 'PixAI', './image.webp']), /--item/);
  });

  it('rejects invalid optional values without partially parsing them', () => {
    const requiredArgs = ['--item', 'aaaaaa', '--platform', 'PixAI'];
    const parseWith = (...args: string[]) => parseStyleGalleryExampleUploadArgs([...requiredArgs, ...args, './image.webp']);

    assert.throws(() => parseWith('--api-base-url', 'ftp://example.com'), /must use HTTP or HTTPS/);
    assert.throws(() => parseWith('--attempts', '0'), /--attempts must be a positive integer/);
    assert.throws(() => parseWith('--attempts', '5x'), /--attempts must be a positive integer/);
    assert.throws(() => parseWith('--concurrency=-1'), /--concurrency must be a positive integer/);
    assert.throws(() => parseWith('--concurrency', 'many'), /--concurrency must be a positive integer/);
    assert.throws(() => parseWith('--timeout-ms', '0'), /--timeout-ms must be a positive integer/);
    assert.throws(() => parseWith('--timeout-ms', '12000ms'), /--timeout-ms must be a positive integer/);
  });

  it('preserves complete multilingual prompts and paragraph breaks beyond 500 characters', () => {
    const prompt = `${'玫红色长发，黄绿色眼睛，天空与云层。'.repeat(100)}\n\n${'Soft light and fine linework. '.repeat(50)}\nFin.`;
    const options = parseStyleGalleryExampleUploadArgs([
      '--item',
      'aaaaaa',
      '--platform',
      'PixAI',
      '--note',
      prompt,
      './image.webp',
    ]);
    assert.ok(prompt.length > 500);
    assert.equal(options.note, prompt);
  });
});
