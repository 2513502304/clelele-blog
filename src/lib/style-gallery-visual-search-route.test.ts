import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { POST } from '../pages/api/style-gallery/visual-search';
import { encodeQuantizedEmbedding } from './style-gallery-visual-feature';
import { STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION } from './style-gallery-visual-types';

function createRequest(body: unknown): Request {
  return new Request('https://example.test/api/style-gallery/visual-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('style gallery visual search route', () => {
  it('keeps validation details for clients but hides unexpected storage errors', async () => {
    const invalid = await POST({ request: createRequest({ mode: 'palette' }) } as never);
    assert.equal(invalid.status, 400);

    const embedding = new Float32Array(STYLE_GALLERY_VISUAL_EMBEDDING_DIMENSION);
    embedding[0] = 1;
    const validRequest = createRequest({
      mode: 'combined',
      scope: 'source',
      range: 50,
      feature: {
        imageHash: 'a'.repeat(64),
        perceptualHash: '0'.repeat(16),
        differenceHash: '0'.repeat(16),
        palette: 'A'.repeat(32),
        embedding: encodeQuantizedEmbedding(embedding),
      },
    });
    const previousConsoleError = console.error;
    const logged: unknown[][] = [];
    console.error = (...args) => logged.push(args);
    try {
      const response = await POST({ request: validRequest } as never);
      assert.equal(response.status, 500);
      assert.equal(await response.text(), 'Visual search failed.');
      assert.equal(logged.length, 1);
    } finally {
      console.error = previousConsoleError;
    }
  });
});
