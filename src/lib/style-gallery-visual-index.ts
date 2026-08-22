import { decodePalette, decodeQuantizedEmbedding, hammingDistance } from './style-gallery-visual-feature';
import type {
  StyleGalleryVisualFeature,
  StyleGalleryVisualIndex,
  StyleGalleryVisualRecord,
  StyleGalleryVisualRecordInput,
  StyleGalleryVisualSearchMode,
  StyleGalleryVisualSearchRange,
  StyleGalleryVisualSearchResult,
  StyleGalleryVisualSearchScope,
} from './style-gallery-visual-types';

/**
 * 将一批图片按 SHA-256 合并进派生索引，并以 kind/sourceSlug/imageId 覆盖同一逻辑记录。
 * 删除无引用 feature 的压缩步骤放在同一次操作中，防止反复上传/删除留下永久膨胀的向量垃圾。
 */
export function upsertStyleGalleryVisualRecords(
  current: StyleGalleryVisualIndex,
  additions: readonly StyleGalleryVisualRecordInput[],
): StyleGalleryVisualIndex {
  if (additions.length === 0) return current;
  const features = [...current.features];
  const featureByHash = new Map(features.map((feature, index) => [feature.imageHash, index]));
  const records = new Map(current.records.map((record) => [recordIdentity(record), record]));
  for (const addition of additions) {
    let featureIndex = featureByHash.get(addition.feature.imageHash);
    if (featureIndex === undefined) {
      featureIndex = features.length;
      features.push(addition.feature);
      featureByHash.set(addition.feature.imageHash, featureIndex);
    } else {
      // 同一字节的确定性特征应完全一致；重新计算可覆盖旧模型迁移过程中的残留值。
      features[featureIndex] = addition.feature;
    }
    records.set(recordIdentity(addition), {
      featureIndex,
      kind: addition.kind,
      sourceSlug: addition.sourceSlug,
      imageId: addition.imageId,
    });
  }
  return compactStyleGalleryVisualIndex({
    ...current,
    updatedAt: new Date().toISOString(),
    features,
    records: [...records.values()],
  });
}

export function removeStyleGalleryVisualRecords(
  current: StyleGalleryVisualIndex,
  predicate: (record: StyleGalleryVisualRecord) => boolean,
): StyleGalleryVisualIndex {
  const records = current.records.filter((record) => !predicate(record));
  if (records.length === current.records.length) return current;
  return compactStyleGalleryVisualIndex({ ...current, updatedAt: new Date().toISOString(), records });
}

/**
 * 用一批 source 真相替换被本次 item 写入触及的旧记录。草稿不在 additions 中，因此会同步清理；
 * 先删后加也能处理同一图片集合被更正或 canonical slug 发生变化的情况。
 */
export function replaceStyleGallerySourceVisualRecords(
  current: StyleGalleryVisualIndex,
  touchedSlugs: ReadonlySet<string>,
  additions: readonly StyleGalleryVisualRecordInput[],
): StyleGalleryVisualIndex {
  const withoutTouchedSources = removeStyleGalleryVisualRecords(
    current,
    (record) => record.kind === 'source' && touchedSlugs.has(record.sourceSlug),
  );
  return upsertStyleGalleryVisualRecords(withoutTouchedSources, additions);
}

interface SourceItemIdentity {
  slug: string;
  imageHash: string;
  draft?: boolean;
}

/**
 * 根据父 item identity 规划 source 索引更新。component image 可以被多个多图 item 共享，因此 canonical
 * slug 只能按父 item 的顶层 imageHash 映射，不能按 record.feature.imageHash 映射。
 */
export function planStyleGallerySourceVisualRecords(
  submittedItems: readonly SourceItemIdentity[],
  writtenItems: readonly SourceItemIdentity[],
  records: readonly StyleGalleryVisualRecordInput[],
): { touchedSlugs: Set<string>; activeRecords: StyleGalleryVisualRecordInput[] } {
  const touchedSlugs = new Set([...submittedItems.map((item) => item.slug), ...writtenItems.map((item) => item.slug)]);
  const submittedItemBySlug = new Map(submittedItems.map((item) => [item.slug, item]));
  const canonicalSlugByItemHash = new Map(writtenItems.map((item) => [item.imageHash, item.slug]));
  const activeRecords = records
    .filter((record) => !submittedItemBySlug.get(record.sourceSlug)?.draft)
    .map((record) => ({
      ...record,
      sourceSlug: canonicalSlugByItemHash.get(submittedItemBySlug.get(record.sourceSlug)?.imageHash ?? '') ?? record.sourceSlug,
    }));
  return { touchedSlugs, activeRecords };
}

/** 删除未引用特征并重新编号；该函数也是一次性重建脚本输出前的最终规范化步骤。 */
export function compactStyleGalleryVisualIndex(index: StyleGalleryVisualIndex): StyleGalleryVisualIndex {
  const used = [...new Set(index.records.map((record) => record.featureIndex))].sort((left, right) => left - right);
  const remap = new Map(used.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  return {
    ...index,
    features: used.map((featureIndex) => index.features[featureIndex]),
    records: index.records.map((record) => {
      const featureIndex = remap.get(record.featureIndex);
      if (featureIndex === undefined) throw new Error('Visual record references a feature removed during compaction.');
      return { ...record, featureIndex };
    }),
  };
}

interface VisualSearchOptions {
  mode: StyleGalleryVisualSearchMode;
  scope: StyleGalleryVisualSearchScope;
  feature?: StyleGalleryVisualFeature;
  color?: string;
  range?: StyleGalleryVisualSearchRange;
  limit?: number;
}

interface PreparedFeature {
  embedding?: Int8Array;
  palette?: Array<[number, number, number, number]>;
  paletteOklab?: Array<[number, number, number, number]>;
}

interface PreparedScope {
  featureIndexes: number[];
  records: StyleGalleryVisualRecord[];
}

// 只缓存当前 Vercel 实例内已经解码的派生值。HF JSON 保持紧凑 base64，不以存储膨胀换查询速度。
const preparedFeatureCache = new WeakMap<StyleGalleryVisualFeature, PreparedFeature>();
const preparedScopeCache = new WeakMap<StyleGalleryVisualIndex, Map<StyleGalleryVisualSearchScope, PreparedScope>>();

/**
 * 当前规模约 8k 张图，顺序扫描 384 维 int8 向量仅约 300 万次整数乘加，比引入向量数据库更快且更易维护。
 * 当图片数量增长到扫描耗时可感知时，再以此函数作为基准切换 ANN；页面/API 契约无需改变。
 */
export function searchStyleGalleryVisualIndex(
  index: StyleGalleryVisualIndex,
  options: VisualSearchOptions,
): StyleGalleryVisualSearchResult[] {
  // 结果只是稳定 ID 和分数，当前完整规模仍远低于响应体限制。宽松色彩筛选可能命中大部分图片，
  // 因此默认不以旧的 500 条上限静默牺牲召回；未来超过 1 万条时应改为显式分页而非再次暗中截断。
  const limit = Math.max(1, Math.min(options.limit ?? 10_000, 10_000));
  const range = normalizeRange(options.range);
  const queryFeature = options.feature ? getPreparedFeature(options.feature) : null;
  const queryEmbedding = queryFeature?.embedding ?? null;
  const queryPalette = queryFeature?.paletteOklab ?? null;
  const queryColor = options.color ? parseHexColor(options.color) : null;
  const scoreByFeature = new Map<number, number>();
  const scope = getPreparedScope(index, options.scope);

  for (const featureIndex of scope.featureIndexes) {
    const candidate = index.features[featureIndex];
    let score = 0;
    if (options.mode === 'palette') {
      if (!queryColor) continue;
      score = scorePaletteColor(candidate, queryColor, interpolateRange(range, 0.045, 0.09, 0.16));
      if (score < interpolateRange(range, 0.2, 0.12, 0.06)) continue;
    } else {
      if (!options.feature || !queryEmbedding || !queryPalette) continue;
      if (candidate.imageHash === options.feature.imageHash) {
        score = 1;
      } else {
        const preparedCandidate = getPreparedFeature(candidate);
        const hashScore = scoreHashes(options.feature, candidate);
        const semanticScore = cosineQuantized(queryEmbedding, preparedCandidate.embedding);
        const paletteScore = scorePalettePair(queryPalette, preparedCandidate.paletteOklab);
        if (options.mode === 'near-duplicate') {
          if (
            Math.min(
              hammingDistance(options.feature.perceptualHash, candidate.perceptualHash),
              hammingDistance(options.feature.differenceHash, candidate.differenceHash),
            ) > Math.round(interpolateRange(range, 4, 16, 28))
          )
            continue;
          // 任一 64 位灰度哈希都可能碰撞；非精确 SHA 命中必须再由语义或主色至少一项佐证。
          // 宽松范围降低佐证门槛以保留裁切、压缩等版本召回，但不会让单哈希碰撞独自通过。
          if (
            semanticScore < interpolateRange(range, 0.75, 0.45, 0.25) &&
            paletteScore < interpolateRange(range, 0.8, 0.5, 0.3)
          )
            continue;
          score = hashScore * 0.8 + semanticScore * 0.15 + paletteScore * 0.05;
        } else if (options.mode === 'semantic') {
          score = semanticScore;
          if (score < interpolateRange(range, 0.8, 0.55, 0.35)) continue;
        } else {
          score = semanticScore * 0.72 + hashScore * 0.18 + paletteScore * 0.1;
          if (score < interpolateRange(range, 0.72, 0.5, 0.35)) continue;
        }
      }
    }
    scoreByFeature.set(featureIndex, score);
  }

  return scope.records
    .filter((record) => scoreByFeature.has(record.featureIndex))
    .map((record) => ({
      kind: record.kind,
      sourceSlug: record.sourceSlug,
      imageId: record.imageId,
      score: Math.round((scoreByFeature.get(record.featureIndex) ?? 0) * 10_000) / 10_000,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function normalizeRange(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
}

/** 0/50/100 分别锚定原来的严格/适中/宽泛参数，区间内线性插值，避免滑块出现难以解释的跳变。 */
function interpolateRange(range: number, strict: number, recommended: number, broad: number): number {
  return range <= 50
    ? strict + (recommended - strict) * (range / 50)
    : recommended + (broad - recommended) * ((range - 50) / 50);
}

function getPreparedScope(index: StyleGalleryVisualIndex, scope: StyleGalleryVisualSearchScope): PreparedScope {
  let scopes = preparedScopeCache.get(index);
  if (!scopes) {
    scopes = new Map();
    preparedScopeCache.set(index, scopes);
  }
  const cached = scopes.get(scope);
  if (cached) return cached;
  const records = index.records.filter((record) => record.kind === scope);
  const prepared = { records, featureIndexes: [...new Set(records.map((record) => record.featureIndex))] };
  scopes.set(scope, prepared);
  return prepared;
}

function getPreparedFeature(feature: StyleGalleryVisualFeature): Required<PreparedFeature> {
  const cached = preparedFeatureCache.get(feature) ?? {};
  if (!cached.embedding) cached.embedding = decodeQuantizedEmbedding(feature.embedding);
  if (!cached.palette) cached.palette = decodePalette(feature.palette);
  if (!cached.paletteOklab) {
    cached.paletteOklab = cached.palette.map(([red, green, blue, weight]) => {
      const [lightness, greenRed, blueYellow] = rgbToOklab(red, green, blue);
      return [lightness, greenRed, blueYellow, weight];
    });
  }
  preparedFeatureCache.set(feature, cached);
  return cached as Required<PreparedFeature>;
}

function recordIdentity(record: Pick<StyleGalleryVisualRecord, 'kind' | 'sourceSlug' | 'imageId'>): string {
  return `${record.kind}\n${record.sourceSlug}\n${record.imageId}`;
}

function scoreHashes(query: StyleGalleryVisualFeature, candidate: StyleGalleryVisualFeature): number {
  const pHash = 1 - hammingDistance(query.perceptualHash, candidate.perceptualHash) / 64;
  const dHash = 1 - hammingDistance(query.differenceHash, candidate.differenceHash) / 64;
  return Math.max(0, pHash * 0.65 + dHash * 0.35);
}

function cosineQuantized(left: Int8Array, right: Int8Array): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  const denominator = Math.sqrt(leftNorm * rightNorm);
  return denominator > 0 && Number.isFinite(denominator) ? dot / denominator : -1;
}

function scorePalettePair(
  left: Array<[number, number, number, number]>,
  right: Array<[number, number, number, number]>,
): number {
  let score = 0;
  let weight = 0;
  for (const [lightness, greenRed, blueYellow, rawWeight] of left) {
    if (!rawWeight) continue;
    let distance = Number.POSITIVE_INFINITY;
    for (const [candidateLightness, candidateGreenRed, candidateBlueYellow, candidateWeight] of right) {
      if (!candidateWeight) continue;
      distance = Math.min(
        distance,
        colorDistance([lightness, greenRed, blueYellow], [candidateLightness, candidateGreenRed, candidateBlueYellow]),
      );
    }
    score += Math.exp(-(distance * distance) / (2 * 0.11 * 0.11)) * rawWeight;
    weight += rawWeight;
  }
  return weight ? score / weight : 0;
}

function scorePaletteColor(feature: StyleGalleryVisualFeature, color: [number, number, number], sigma: number): number {
  const target = rgbToOklab(...color);
  let best = 0;
  for (const [lightness, greenRed, blueYellow, weight] of getPreparedFeature(feature).paletteOklab) {
    if (!weight) continue;
    const distance = colorDistance(target, [lightness, greenRed, blueYellow]);
    best = Math.max(best, Math.exp(-(distance * distance) / (2 * sigma * sigma)) * Math.sqrt(weight / 255));
  }
  return best;
}

function parseHexColor(value: string): [number, number, number] | null {
  const match = /^#([a-f0-9]{6})$/i.exec(value);
  if (!match) return null;
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
}

function colorDistance(left: [number, number, number], right: [number, number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

/** OKLab 比 RGB 欧氏距离更接近人眼感知，调色盘容差因此在明暗与不同色相间更稳定。 */
function rgbToOklab(red: number, green: number, blue: number): [number, number, number] {
  const linear = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2]);
  const m = Math.cbrt(0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2]);
  const s = Math.cbrt(0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2]);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
