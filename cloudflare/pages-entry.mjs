/** Preserve the Pages URL, cookies and streaming body across the internal binding. */
export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith('/_internal/')) return new Response('Not found', { status: 404 });
    if (!env.BLOG) return new Response('Origin is not configured', { status: 503 });
    return env.BLOG.fetch(request);
  },
};
