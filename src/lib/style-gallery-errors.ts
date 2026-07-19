export type StyleGalleryClientErrorStatus = 400 | 404 | 409;

/** 标识可安全暴露给客户端的预期请求错误，避免将参数问题统一伪装成 500。 */
export class StyleGalleryClientError extends Error {
  readonly status: StyleGalleryClientErrorStatus;

  constructor(message: string, status: StyleGalleryClientErrorStatus, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StyleGalleryClientError';
    this.status = status;
  }
}

/** 只转换已知客户端错误；未知异常返回 `null`，由路由记录并按服务端故障处理。 */
export function getStyleGalleryClientErrorResponse(error: unknown): Response | null {
  return error instanceof StyleGalleryClientError ? new Response(error.message, { status: error.status }) : null;
}
