import * as http from 'node:http';

/**
 * 让 Node 内置 fetch 在运行时读取 HTTP(S)_PROXY，避免每个 CLI 都依赖调用者额外传入 NODE_OPTIONS。
 * Node 22.21+/24.5+ 支持动态配置；更早版本仍可通过启动参数启用，并在遗漏参数时给出明确提示。
 */
export function configureEnvironmentProxy() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (!proxy) return;
  if (typeof http.setGlobalProxyFromEnv === 'function') {
    http.setGlobalProxyFromEnv();
    try {
      const parsed = new URL(proxy);
      console.log(`Using environment proxy ${parsed.protocol}//${parsed.host}.`);
    } catch {
      console.log('Using configured environment proxy.');
    }
    return;
  }
  const proxyEnabled = process.env.NODE_USE_ENV_PROXY === '1' || process.env.NODE_OPTIONS?.includes('--use-env-proxy');
  if (!proxyEnabled) {
    console.warn('Proxy variables are set, but this Node version requires NODE_OPTIONS=--use-env-proxy.');
  }
}
