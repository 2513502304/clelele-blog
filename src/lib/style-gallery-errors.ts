export type StyleGalleryClientErrorStatus = 400 | 404 | 409;

/** Identifies expected request failures that API routes should expose as 4xx responses. */
export class StyleGalleryClientError extends Error {
  readonly status: StyleGalleryClientErrorStatus;

  constructor(message: string, status: StyleGalleryClientErrorStatus, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StyleGalleryClientError';
    this.status = status;
  }
}

/** Converts known gallery request failures to responses without masking unexpected server errors. */
export function getStyleGalleryClientErrorResponse(error: unknown): Response | null {
  return error instanceof StyleGalleryClientError ? new Response(error.message, { status: error.status }) : null;
}
