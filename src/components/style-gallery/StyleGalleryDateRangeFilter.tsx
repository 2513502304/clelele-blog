import { ErrorBoundary, InlineErrorFallback } from '@components/common';
import Popover from '@components/ui/popover';
import { Icon } from '@iconify/react';
import {
  getStyleGalleryBoundaryDateKey,
  getStyleGalleryRollingDateRange,
  getStyleGalleryTodayRange,
  isStyleGalleryDateKey,
  isStyleGalleryDateTimeValue,
  normalizeStyleGalleryDateRange,
  type StyleGalleryDateBoundary,
  type StyleGalleryDateRange,
  updateStyleGalleryDateRangeFromDay,
} from '@lib/style-gallery-date-range';
import type { StyleGalleryDateRangeLabels } from '@lib/style-gallery-date-range-labels';
import { cn } from '@lib/utils';
import { useMemo, useState } from 'react';

interface StyleGalleryDateRangeFilterProps {
  value: StyleGalleryDateRange;
  locale: string;
  labels: StyleGalleryDateRangeLabels;
  availableDateKeys: readonly string[];
  onApply: (range: StyleGalleryDateRange) => void;
  triggerClassName?: string;
}

interface DateRangeActionsProps {
  layout: 'desktop' | 'mobile';
  labels: Pick<StyleGalleryDateRangeLabels, 'apply' | 'cancel' | 'reset'>;
  resetDisabled: boolean;
  onReset: () => void;
  onCancel: () => void;
  onApply: () => void;
}

const QUICK_RANGES = [1, 7, 14, 30] as const;

function dateKeyToUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function utcDateToKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getDateTimeInputValue(value: string, boundary: StyleGalleryDateBoundary): string {
  if (isStyleGalleryDateTimeValue(value)) return value;
  if (isStyleGalleryDateKey(value)) return `${value}T${boundary === 'from' ? '00:00' : '23:59'}`;
  return '';
}

function formatBoundaryValue(value: string, boundary: StyleGalleryDateBoundary): { date: string; time: string } {
  const inputValue = getDateTimeInputValue(value, boundary);
  if (!inputValue) return { date: 'yyyy/mm/dd', time: '--:--' };
  return { date: inputValue.slice(0, 10).replaceAll('-', '/'), time: inputValue.slice(11) };
}

function firstDayOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addMonths(value: Date, amount: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount, 1));
}

function getCalendarDays(month: Date): Date[] {
  const first = firstDayOfMonth(month);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return date;
  });
}

/** 桌面与移动布局共用同一套提交语义，仅保留容器和按钮宽度差异。 */
function DateRangeActions({ layout, labels, resetDisabled, onReset, onCancel, onApply }: DateRangeActionsProps) {
  const desktop = layout === 'desktop';
  return (
    <div
      className={cn(
        desktop
          ? 'hidden shrink-0 items-center justify-between gap-3 border-border border-t bg-background/95 p-3 backdrop-blur-xl md:flex'
          : 'mt-auto flex items-center justify-between gap-2 pt-3 md:hidden',
      )}
    >
      <button
        type="button"
        onClick={onReset}
        disabled={resetDisabled}
        className={cn(
          'h-9 rounded-md font-medium text-muted-foreground text-xs transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
          desktop ? 'px-2.5' : 'px-2',
        )}
      >
        {labels.reset}
      </button>
      <div className={cn('flex', desktop ? 'gap-2' : 'gap-1.5')}>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'h-9 rounded-md border border-border font-medium text-xs transition hover:bg-muted',
            desktop ? 'px-3' : 'px-2.5',
          )}
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          onClick={onApply}
          className={cn(
            'h-9 rounded-md bg-primary font-bold text-primary-foreground text-xs transition hover:opacity-90',
            desktop ? 'px-4' : 'px-3',
          )}
        >
          {labels.apply}
        </button>
      </div>
    </div>
  );
}

/**
 * 三个 Gallery 集合页共享的日期范围选择器。弹窗内使用草稿值，关闭或取消不会改变当前列表；
 * 日历会持续扩展或收缩同一个范围，区间内的歧义由当前激活的开始/结束字段决定。
 */
function StyleGalleryDateRangeFilterContent({
  value,
  locale,
  labels,
  availableDateKeys,
  onApply,
  triggerClassName,
}: StyleGalleryDateRangeFilterProps) {
  const applied = normalizeStyleGalleryDateRange(value);
  const todayRange = getStyleGalleryTodayRange();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<StyleGalleryDateRange>(applied);
  const [activeBoundary, setActiveBoundary] = useState<StyleGalleryDateBoundary>('from');
  const [followToday, setFollowToday] = useState(false);
  const initialMonthKey =
    getStyleGalleryBoundaryDateKey(applied.from) ?? getStyleGalleryBoundaryDateKey(applied.to) ?? todayRange.to.slice(0, 10);
  const [visibleMonth, setVisibleMonth] = useState(() => firstDayOfMonth(dateKeyToUtcDate(initialMonthKey)));
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }),
    [locale],
  );
  const fullDateFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }), [locale]);
  const weekdayFormatter = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }), [locale]);
  const calendarDays = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);
  const availableDates = useMemo(() => new Set(availableDateKeys), [availableDateKeys]);
  const calendarRange = normalizeStyleGalleryDateRange(draft);
  const calendarFromDate = getStyleGalleryBoundaryDateKey(calendarRange.from);
  const calendarToDate = getStyleGalleryBoundaryDateKey(calendarRange.to);
  const activeBoundaryDate = getStyleGalleryBoundaryDateKey(calendarRange[activeBoundary]);
  const weekdays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, day) => ({
        key: `weekday-${day}`,
        label: weekdayFormatter.format(new Date(Date.UTC(2026, 7, 2 + day))),
      })),
    [weekdayFormatter],
  );
  const hasRange = Boolean(applied.from || applied.to);
  const summary = hasRange
    ? `${applied.from ? dateFormatter.format(dateKeyToUtcDate(getStyleGalleryBoundaryDateKey(applied.from) ?? '')) : '…'} – ${
        applied.to ? dateFormatter.format(dateKeyToUtcDate(getStyleGalleryBoundaryDateKey(applied.to) ?? '')) : '…'
      }`
    : labels.allDates;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setDraft(applied);
      setActiveBoundary(applied.from ? 'to' : 'from');
      setFollowToday(false);
      const monthKey =
        getStyleGalleryBoundaryDateKey(applied.from) ??
        getStyleGalleryBoundaryDateKey(applied.to) ??
        todayRange.to.slice(0, 10);
      setVisibleMonth(firstDayOfMonth(dateKeyToUtcDate(monthKey)));
    }
    setOpen(nextOpen);
  }

  function selectDay(dateKey: string) {
    const next = updateStyleGalleryDateRangeFromDay(draft, dateKey, activeBoundary);
    setDraft(next.range);
    setActiveBoundary(next.activeBoundary);
    if (next.activeBoundary === 'to') setFollowToday(false);
  }

  function applyQuickRange(days: number) {
    const next = getStyleGalleryRollingDateRange(days);
    setDraft(next);
    setActiveBoundary('to');
    setFollowToday(false);
    setVisibleMonth(firstDayOfMonth(dateKeyToUtcDate(next.to.slice(0, 10))));
  }

  function applyTodayRange() {
    const next = getStyleGalleryTodayRange();
    setDraft(next);
    setActiveBoundary('to');
    setFollowToday(true);
    setVisibleMonth(firstDayOfMonth(dateKeyToUtcDate(next.to.slice(0, 10))));
  }

  function updateBoundary(boundary: StyleGalleryDateBoundary, nextValue: string) {
    if (boundary === 'to') setFollowToday(false);
    if (!isStyleGalleryDateTimeValue(nextValue)) {
      setActiveBoundary(boundary);
      setDraft((current) => ({ ...current, [boundary]: '' }));
      return;
    }
    const next = normalizeStyleGalleryDateRange({ ...draft, [boundary]: nextValue });
    setDraft(next);
    setActiveBoundary(next.from === nextValue ? 'from' : 'to');
    setVisibleMonth(firstDayOfMonth(dateKeyToUtcDate(nextValue.slice(0, 10))));
  }

  function toggleFollowToday(checked: boolean) {
    setFollowToday(checked);
    if (!checked) return;
    setActiveBoundary('to');
    const currentToday = getStyleGalleryTodayRange();
    setDraft((current) => ({
      from: current.from && current.from <= currentToday.to ? current.from : currentToday.from,
      to: currentToday.to,
    }));
    setVisibleMonth(firstDayOfMonth(dateKeyToUtcDate(currentToday.to.slice(0, 10))));
  }

  function isQuickRangeActive(days: number): boolean {
    const quickRange = getStyleGalleryRollingDateRange(days);
    return draft.from === quickRange.from && draft.to === quickRange.to;
  }

  function isTodayActive(): boolean {
    const currentToday = getStyleGalleryTodayRange();
    return draft.from === currentToday.from && draft.to === currentToday.to;
  }

  const boundaryLabels: Record<StyleGalleryDateBoundary, string> = {
    from: labels.startDate,
    to: labels.endDate,
  };

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      placement="bottom-end"
      offset={6}
      dismissOnAncestorScroll={false}
      enableFlip={false}
      constrainToAvailableHeight
      className="z-[100] w-[min(36rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-border bg-background/95 p-0 shadow-xl backdrop-blur-xl"
      render={({ close }) => {
        const resetAndClose = () => {
          onApply({ from: '', to: '' });
          close();
        };
        const applyAndClose = () => {
          const finalDraft = followToday ? { ...draft, to: getStyleGalleryTodayRange().to } : draft;
          onApply(normalizeStyleGalleryDateRange(finalDraft));
          close();
        };

        return (
          <div className="flex max-h-[inherit] flex-col">
            <div className="min-h-0 overflow-y-auto p-3">
              <div className="flex flex-wrap gap-1.5 border-border border-b pb-3">
                <button
                  type="button"
                  onClick={applyTodayRange}
                  className={cn(
                    'h-8 rounded-md border px-2.5 font-medium text-xs transition',
                    isTodayActive()
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border hover:border-primary/40 hover:text-primary',
                  )}
                >
                  {labels.today}
                </button>
                {QUICK_RANGES.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => applyQuickRange(days)}
                    className={cn(
                      'h-8 rounded-md border px-2.5 font-medium text-xs transition',
                      isQuickRangeActive(days)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/40 hover:text-primary',
                    )}
                  >
                    {days === 1 ? labels.lastDay : labels.lastDays.replace('{days}', String(days))}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-[14rem_minmax(18rem,1fr)] items-stretch gap-3 pt-3 md:grid-cols-1">
                <div className="flex min-h-full flex-col gap-2.5">
                  <p className="px-0.5 text-muted-foreground text-xs">{labels.dateTimeSupported}</p>
                  {(['from', 'to'] as const).map((boundary) => {
                    const formatted = formatBoundaryValue(draft[boundary], boundary);
                    return (
                      <label
                        key={boundary}
                        className={cn(
                          'relative block cursor-pointer overflow-hidden rounded-md border bg-background transition',
                          activeBoundary === boundary
                            ? 'border-primary bg-primary/5 ring-2 ring-primary/30'
                            : 'border-border hover:border-primary/40',
                        )}
                      >
                        <input
                          type="datetime-local"
                          value={getDateTimeInputValue(draft[boundary], boundary)}
                          onFocus={() => setActiveBoundary(boundary)}
                          onPointerDown={() => setActiveBoundary(boundary)}
                          onChange={(event) => updateBoundary(boundary, event.currentTarget.value)}
                          aria-label={boundaryLabels[boundary]}
                          className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
                        />
                        <span className="pointer-events-none flex h-18 flex-col justify-center gap-1 px-3">
                          <span className="font-medium text-[11px] text-muted-foreground">{boundaryLabels[boundary]}</span>
                          <span
                            className={cn(
                              'flex items-center justify-between gap-3 text-sm tabular-nums',
                              !draft[boundary] && 'text-muted-foreground',
                            )}
                          >
                            <span>{formatted.date}</span>
                            <span>{formatted.time}</span>
                          </span>
                        </span>
                      </label>
                    );
                  })}

                  <label className="flex cursor-pointer items-center gap-2 px-0.5 text-muted-foreground text-xs">
                    <input
                      type="checkbox"
                      checked={followToday}
                      onChange={(event) => toggleFollowToday(event.currentTarget.checked)}
                      className="size-4 rounded border-border accent-primary"
                    />
                    <span>{labels.followToday}</span>
                  </label>

                  <DateRangeActions
                    layout="mobile"
                    labels={labels}
                    resetDisabled={!hasRange && !draft.from && !draft.to}
                    onReset={resetAndClose}
                    onCancel={close}
                    onApply={applyAndClose}
                  />
                </div>

                <div className="rounded-lg border border-border p-2.5">
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setVisibleMonth((month) => addMonths(month, -1))}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      aria-label={labels.previousMonth}
                      title={labels.previousMonth}
                    >
                      <Icon icon="ri:arrow-left-s-line" className="size-5" />
                    </button>
                    <strong className="text-sm">{monthFormatter.format(visibleMonth)}</strong>
                    <button
                      type="button"
                      onClick={() => setVisibleMonth((month) => addMonths(month, 1))}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                      aria-label={labels.nextMonth}
                      title={labels.nextMonth}
                    >
                      <Icon icon="ri:arrow-right-s-line" className="size-5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground">
                    {weekdays.map((weekday) => (
                      <span key={weekday.key} className="py-0.5 font-medium">
                        {weekday.label}
                      </span>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-y-0.5">
                    {calendarDays.map((day) => {
                      const dateKey = utcDateToKey(day);
                      const isCurrentMonth = day.getUTCMonth() === visibleMonth.getUTCMonth();
                      const isAvailable = availableDates.has(dateKey);
                      const isBoundary = dateKey === calendarFromDate || dateKey === calendarToDate;
                      const isActiveBoundary = dateKey === activeBoundaryDate;
                      const isInRange = Boolean(
                        calendarFromDate && calendarToDate && dateKey >= calendarFromDate && dateKey <= calendarToDate,
                      );
                      return (
                        <button
                          key={dateKey}
                          type="button"
                          onClick={() => selectDay(dateKey)}
                          disabled={!isAvailable}
                          title={!isAvailable ? labels.noItemsOnDate : undefined}
                          aria-label={`${fullDateFormatter.format(day)}${!isAvailable ? `, ${labels.noItemsOnDate}` : ''}`}
                          aria-pressed={isInRange}
                          className={cn(
                            'mx-auto flex size-7.5 items-center justify-center rounded-md text-xs tabular-nums transition',
                            !isAvailable
                              ? 'cursor-not-allowed text-muted-foreground/25'
                              : isBoundary
                                ? 'bg-primary font-bold text-primary-foreground shadow-sm'
                                : isInRange
                                  ? 'bg-primary/12 text-primary'
                                  : isCurrentMonth
                                    ? 'text-foreground hover:bg-muted'
                                    : 'text-muted-foreground/45 hover:bg-muted',
                            isActiveBoundary &&
                              calendarRange.from !== calendarRange.to &&
                              'ring-2 ring-primary/35 ring-offset-1',
                          )}
                        >
                          {day.getUTCDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <DateRangeActions
              layout="desktop"
              labels={labels}
              resetDisabled={!hasRange && !draft.from && !draft.to}
              onReset={resetAndClose}
              onCancel={close}
              onApply={applyAndClose}
            />
          </div>
        );
      }}
    >
      <button
        type="button"
        aria-label={`${labels.filter}: ${summary}`}
        aria-expanded={open}
        onClick={(event) => {
          if (!open) event.currentTarget.scrollIntoView({ block: 'start' });
        }}
        className={cn(
          'inline-flex h-10 max-w-full scroll-mt-20 items-center gap-2 rounded-md border px-3 text-sm transition',
          hasRange
            ? 'border-primary/50 bg-primary/10 font-medium text-primary'
            : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
          triggerClassName,
        )}
      >
        <Icon icon="ri:calendar-line" className="size-4 shrink-0" />
        <span className="truncate">{summary}</span>
        <Icon icon="ri:arrow-down-s-line" className="size-4 shrink-0" />
      </button>
    </Popover>
  );
}

/** 将日期控件自身的渲染异常限制在筛选器内，避免连带卸载所在 Gallery 的其余交互。 */
export default function StyleGalleryDateRangeFilter(props: StyleGalleryDateRangeFilterProps) {
  return (
    <ErrorBoundary FallbackComponent={InlineErrorFallback}>
      <StyleGalleryDateRangeFilterContent {...props} />
    </ErrorBoundary>
  );
}
