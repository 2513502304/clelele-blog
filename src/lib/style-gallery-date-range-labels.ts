import { type Locale, t } from '@/i18n';

export interface StyleGalleryDateRangeLabels {
  filter: string;
  allDates: string;
  startDate: string;
  endDate: string;
  today: string;
  lastDay: string;
  lastDays: string;
  previousMonth: string;
  nextMonth: string;
  dateTimeSupported: string;
  followToday: string;
  reset: string;
  cancel: string;
  apply: string;
  noItemsOnDate: string;
}

/** 三个 Gallery 集合页共用同一组日期筛选文案，避免路由层字段随维护逐渐漂移。 */
export function createStyleGalleryDateRangeLabels(locale: Locale): StyleGalleryDateRangeLabels {
  return {
    filter: t(locale, 'gallery.dateFilter'),
    allDates: t(locale, 'gallery.allDates'),
    startDate: t(locale, 'gallery.startDate'),
    endDate: t(locale, 'gallery.endDate'),
    today: t(locale, 'gallery.today'),
    lastDay: t(locale, 'gallery.lastDay'),
    lastDays: t(locale, 'gallery.lastDays', { days: '{days}' }),
    previousMonth: t(locale, 'gallery.previousMonth'),
    nextMonth: t(locale, 'gallery.nextMonth'),
    dateTimeSupported: t(locale, 'gallery.dateTimeSupported'),
    followToday: t(locale, 'gallery.followToday'),
    reset: t(locale, 'gallery.resetDateFilter'),
    cancel: t(locale, 'gallery.cancelDateFilter'),
    apply: t(locale, 'gallery.applyDateFilter'),
    noItemsOnDate: t(locale, 'gallery.noItemsOnDate'),
  };
}
