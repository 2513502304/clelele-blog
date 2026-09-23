/**
 * A lost HTTP response does not cancel a server mutation. Send each replacement batch once;
 * after a transport/server failure, only poll authenticated identities until publication is
 * confirmed or the request deadline expires. Never replay an in-flight write or merge a conflict.
 */
export async function publishReplacementBatch(
  send,
  replacements,
  {
    timeoutMs = 300_000,
    intervalMs = 5_000,
    now = Date.now,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    warn = console.warn,
  } = {},
) {
  const deadline = now() + timeoutMs + intervalMs;
  try {
    const result = await send({ action: 'replace', replacements });
    // A fulfilled request with no response object still cannot confirm publication.
    if (
      !result ||
      !Array.isArray(result.items) ||
      result.items.length !== replacements.length ||
      !result.items.every((item, index) => {
        const job = replacements[index];
        return (
          item?.imageHash === job.item.imageHash && item.slug === `${job.slug.slice(0, -12)}${job.item.imageHash.slice(0, 12)}`
        );
      }) ||
      !Number.isInteger(result.changed) ||
      result.changed < 0 ||
      !Array.isArray(result.changedSlugs) ||
      new Set(result.changedSlugs).size !== result.changed ||
      result.changedSlugs.length !== result.changed ||
      !result.changedSlugs.every((slug) => result.items.some((item) => item.slug === slug))
    )
      throw new Error('Replacement response did not contain a complete result.');
    return result;
  } catch (error) {
    if (error.status && error.status !== 409) throw error;
    warn('替换请求未能正常返回，正在回读线上结果；此时不会重复发送写入请求。');
    do {
      try {
        const matches = await send({
          action: 'resolve',
          queries: replacements.map((job) => ({ hashes: job.hashes, legacySlug: job.slug })),
        });
        if (
          matches.length === replacements.length &&
          matches.every((match, index) => {
            const job = replacements[index];
            return (
              match?.item.imageHash === job.item.imageHash &&
              match.item.slug === `${job.slug.slice(0, -12)}${job.item.imageHash.slice(0, 12)}`
            );
          })
        ) {
          const items = matches.map((match) => match.item);
          return { items, changed: items.length, changedSlugs: items.map((item) => item.slug), readback: true };
        }
      } catch {
        // In-flight redirects/index publication can temporarily prevent a complete readback.
        // Read errors never authorize another write, including conflicts between active cards.
      }
      if (error.status === 409 || now() >= deadline) break;
      await wait(Math.min(intervalMs, deadline - now()));
    } while (now() <= deadline);
    throw new Error('未能确认本批替换已全部完成，已停止且未重复发送。请先检查线上状态和恢复记录，再重跑导入。', {
      cause: error,
    });
  }
}
