/** 在当前 Node 运行时支持时，让全局 HTTP 客户端读取 HTTP(S)_PROXY。 */
export function configureEnvironmentProxy(): void;

/** 判断指定 Node 版本是否支持启动时的环境代理开关。 */
export function supportsEnvironmentProxyStartup(version: string): boolean;
