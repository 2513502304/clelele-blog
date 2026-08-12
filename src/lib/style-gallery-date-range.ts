import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const STYLE_GALLERY_TIME_ZONE = 'Asia/Shanghai';

export interface StyleGalleryDateRange {
  /** 上海时区的 yyyy-MM-dd 或 yyyy-MM-ddTHH:mm；日期值兼容旧 URL，并分别解释为日初/日末。 */
  from: string;
  to: string;
}

export type StyleGalleryDateBoundary = keyof StyleGalleryDateRange;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** 校验 URL 和日期输入使用的 yyyy-MM-dd 自然日，拒绝 2 月 30 日一类会被 Date 自动进位的值。 */
export function isStyleGalleryDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** 校验浏览器 datetime-local 产生的上海本地时间，并排除自动进位的无效日期。 */
export function isStyleGalleryDateTimeValue(value: string): boolean {
  if (!DATE_TIME_LOCAL_PATTERN.test(value)) return false;
  const parsed = fromZonedTime(value, STYLE_GALLERY_TIME_ZONE);
  return !Number.isNaN(parsed.getTime()) && formatInTimeZone(parsed, STYLE_GALLERY_TIME_ZONE, "yyyy-MM-dd'T'HH:mm") === value;
}

function isStyleGalleryBoundaryValue(value: string): boolean {
  return isStyleGalleryDateKey(value) || isStyleGalleryDateTimeValue(value);
}

/** 将持久化 UTC 时间转换为 Gallery 面向用户展示和日历统计的上海自然日。 */
export function getStyleGalleryDateKey(value: string | Date): string | null {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatInTimeZone(parsed, STYLE_GALLERY_TIME_ZONE, 'yyyy-MM-dd');
}

/** 从日期或本地日期时间边界取出日历日期。 */
export function getStyleGalleryBoundaryDateKey(value: string): string | null {
  if (isStyleGalleryDateKey(value)) return value;
  return isStyleGalleryDateTimeValue(value) ? value.slice(0, 10) : null;
}

/** 将时间转换为 datetime-local 可直接消费的上海本地分钟值。 */
export function getStyleGalleryDateTimeValue(value: Date): string {
  return formatInTimeZone(value, STYLE_GALLERY_TIME_ZONE, "yyyy-MM-dd'T'HH:mm");
}

function getBoundaryInstant(value: string, boundary: StyleGalleryDateBoundary): number | null {
  if (isStyleGalleryDateTimeValue(value)) {
    const minuteStart = fromZonedTime(value, STYLE_GALLERY_TIME_ZONE).getTime();
    // datetime-local 只暴露到分钟；结束边界必须覆盖整分钟，否则 23:59:30 之类的记录会被意外排除。
    return boundary === 'to' ? minuteStart + 60_000 - 1 : minuteStart;
  }
  if (!isStyleGalleryDateKey(value)) return null;
  const edge = boundary === 'from' ? '00:00:00.000' : '23:59:59.999';
  return fromZonedTime(`${value}T${edge}`, STYLE_GALLERY_TIME_ZONE).getTime();
}

/** 清理无效边界，并允许用户以任意顺序填写起止时间。 */
export function normalizeStyleGalleryDateRange(range: StyleGalleryDateRange): StyleGalleryDateRange {
  const from = isStyleGalleryBoundaryValue(range.from) ? range.from : '';
  const to = isStyleGalleryBoundaryValue(range.to) ? range.to : '';
  const fromInstant = getBoundaryInstant(from, 'from');
  const toInstant = getBoundaryInstant(to, 'to');
  if (fromInstant !== null && toInstant !== null && fromInstant > toInstant) return { from: to, to: from };
  return { from, to };
}

function getDayBoundaryValue(dateKey: string, boundary: StyleGalleryDateBoundary): string {
  return `${dateKey}T${boundary === 'from' ? '00:00' : '23:59'}`;
}

/**
 * 在日历上持续调整同一个范围，而不是把每两次点击视为一次全新选择。
 * 区间外点击自然扩展最近边界；区间内点击由当前激活的开始/结束字段决定收缩哪一侧。
 */
export function updateStyleGalleryDateRangeFromDay(
  range: StyleGalleryDateRange,
  dateKey: string,
  activeBoundary: StyleGalleryDateBoundary,
): { range: StyleGalleryDateRange; activeBoundary: StyleGalleryDateBoundary } {
  if (!isStyleGalleryDateKey(dateKey)) {
    return { range: normalizeStyleGalleryDateRange(range), activeBoundary };
  }

  const current = normalizeStyleGalleryDateRange(range);
  const fromDate = getStyleGalleryBoundaryDateKey(current.from);
  const toDate = getStyleGalleryBoundaryDateKey(current.to);
  const dayStart = getDayBoundaryValue(dateKey, 'from');
  const dayEnd = getDayBoundaryValue(dateKey, 'to');
  if (!fromDate && !toDate) {
    return { range: { from: dayStart, to: dayEnd }, activeBoundary: 'to' };
  }
  if (!fromDate && toDate) {
    return dateKey <= toDate
      ? { range: { from: dayStart, to: current.to }, activeBoundary: 'from' }
      : { range: { from: current.to, to: dayEnd }, activeBoundary: 'to' };
  }
  if (fromDate && !toDate) {
    return dateKey >= fromDate
      ? { range: { from: current.from, to: dayEnd }, activeBoundary: 'to' }
      : { range: { from: dayStart, to: current.from }, activeBoundary: 'from' };
  }
  if (fromDate && dateKey < fromDate) {
    return { range: { from: dayStart, to: current.to }, activeBoundary: 'from' };
  }
  if (toDate && dateKey > toDate) {
    return { range: { from: current.from, to: dayEnd }, activeBoundary: 'to' };
  }
  return activeBoundary === 'from'
    ? { range: { from: dayStart, to: current.to }, activeBoundary }
    : { range: { from: current.from, to: dayEnd }, activeBoundary };
}

/**
 * 将稳定的筛选范围预编译成匹配器，避免大型 Gallery 在过滤每个 item 时重复解析相同边界。
 * 日期边界按上海时区解释；旧的纯日期 URL 仍包含完整起止自然日。
 */
export function createStyleGalleryDateRangeMatcher(range: StyleGalleryDateRange): (value: string) => boolean {
  const normalized = normalizeStyleGalleryDateRange(range);
  if (!normalized.from && !normalized.to) return () => true;
  const from = getBoundaryInstant(normalized.from, 'from');
  const to = getBoundaryInstant(normalized.to, 'to');
  return (value) => {
    const timestamp = new Date(value).getTime();
    if (Number.isNaN(timestamp)) return false;
    return (from === null || timestamp >= from) && (to === null || timestamp <= to);
  };
}

/** 单次调用兼容层；列表过滤应优先复用 createStyleGalleryDateRangeMatcher 的返回值。 */
export function matchesStyleGalleryDateRange(value: string, range: StyleGalleryDateRange): boolean {
  return createStyleGalleryDateRangeMatcher(range)(value);
}

/** “今天”是上海自然日的 00:00 至当前分钟，不等同于滚动的最近 24 小时。 */
export function getStyleGalleryTodayRange(now = new Date()): StyleGalleryDateRange {
  const to = getStyleGalleryDateTimeValue(now);
  return { from: `${to.slice(0, 10)}T00:00`, to };
}

/** 最近 N 天使用严格的 N×24 小时滚动窗口，因此“最近 1 天”可与“今天”明确区分。 */
export function getStyleGalleryRollingDateRange(days: number, now = new Date()): StyleGalleryDateRange {
  const safeDays = Number.isFinite(days) && days > 0 ? days : 1;
  return {
    from: getStyleGalleryDateTimeValue(new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000)),
    to: getStyleGalleryDateTimeValue(now),
  };
}
