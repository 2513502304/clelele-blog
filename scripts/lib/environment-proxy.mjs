import * as http from 'node:http';

/**
 * 让 Node 内置 fetch 在运行时读取 HTTP(S)_PROXY，避免每个 CLI 都依赖调用者额外传入 NODE_OPTIONS。
 * Node 25.4+ 可在进程内动态配置；Node 22.21+/24.5+ 需要在启动时显式启用环境代理。
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
  if (proxyEnabled && supportsEnvironmentProxyStartup(process.versions.node)) {
    console.log('Using environment proxy configured at Node startup.');
    return;
  }
  throw new Error(
    `HTTP(S)_PROXY is configured, but Node ${process.versions.node} cannot activate it in this process. ` +
      'Use Node 25.4+ or start Node 22.21+/24.5+ with NODE_USE_ENV_PROXY=1 (or NODE_OPTIONS=--use-env-proxy).',
  );
}

/** 判断当前 Node 版本是否支持启动时的环境代理开关。 */
export function supportsEnvironmentProxyStartup(version) {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major >= 25) return true;
  if (major === 24) return minor >= 5;
  return major === 22 && minor >= 21;
}
