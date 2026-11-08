import app from './dist/_worker.js/index.js';

export default {
  /** Block writes before Astro imports route modules or accesses shared production storage. */
  fetch(request, env, context) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return new Response('Migration preview is read-only.', {
        status: 405,
        headers: { Allow: 'GET, HEAD, OPTIONS' },
      });
    }
    return app.fetch(request, env, context);
  },
};
