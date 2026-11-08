/** Only anonymous reads may enter the shared response cache. */
export function canUsePublicCache(request) {
  return (
    ['GET', 'HEAD'].includes(request.method) &&
    !request.headers.has('authorization') &&
    !request.headers.has('cookie') &&
    !request.headers.has('range')
  );
}

/** Translate existing origin cache policy without buffering response bodies. */
export function forEdgeCache(response) {
  const result = new Response(response.body, response);
  const headers = result.headers;
  const browserPolicy = headers.get('cache-control');
  const edgePolicy = headers.get('vercel-cdn-cache-control');
  const tags = headers.get('vercel-cache-tag');
  headers.delete('x-blog-browser-cache-control');
  if (browserPolicy) headers.set('x-blog-browser-cache-control', browserPolicy);
  if (edgePolicy) headers.set('cache-control', edgePolicy);
  if (tags) headers.set('cache-tag', tags);
  // Signed-image redirects explicitly opt into a TTL shorter than the signature's
  // lifetime. Preserve that policy, but never cache an unspecified login redirect.
  const cacheableRedirect =
    [301, 302, 307, 308].includes(response.status) &&
    /(?:^|,)\s*(?:s-maxage|max-age)=[1-9]\d*(?:,|$)/i.test(edgePolicy ?? browserPolicy ?? '');
  // Public headers must never override a personalized or unsuccessful response.
  if (
    (response.status !== 200 && !cacheableRedirect) ||
    headers.has('set-cookie') ||
    /private|no-store/i.test(browserPolicy ?? '')
  ) {
    headers.set('cache-control', 'private, no-store');
    headers.set('x-blog-browser-cache-control', 'private, no-store');
  }
  headers.delete('vercel-cdn-cache-control');
  headers.delete('vercel-cache-tag');
  return result;
}

/** Restore browser revalidation while retaining the longer inner edge TTL. */
export function forBrowser(response) {
  const result = new Response(response.body, response);
  const policy = result.headers.get('x-blog-browser-cache-control');
  if (policy) result.headers.set('cache-control', policy);
  result.headers.delete('x-blog-browser-cache-control');
  result.headers.delete('cache-tag');
  return result;
}

/** Keep authenticated invalidation requests bounded and reject unsupported modes. */
export function parseInvalidation(body) {
  if (
    !body ||
    !['purge', 'invalidate'].includes(body.mode) ||
    !Array.isArray(body.tags) ||
    body.tags.length === 0 ||
    body.tags.length > 128 ||
    body.tags.some((tag) => typeof tag !== 'string' || !/^[a-zA-Z0-9_:-]{1,256}$/.test(tag))
  ) {
    throw new Error('Invalid cache invalidation request.');
  }
  return { mode: body.mode, tags: [...new Set(body.tags)] };
}
