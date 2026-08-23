import type { StyleGalleryVisualFilterLabels } from '@lib/style-gallery-visual-types';
import { type Locale, t } from '@/i18n';

/** 三个集合页共享同一份视觉筛选文案，避免新增模式时只更新部分入口。 */
export function createStyleGalleryVisualFilterLabels(locale: Locale): StyleGalleryVisualFilterLabels {
  return {
    trigger: t(locale, 'gallery.visualFilter'),
    imageTab: t(locale, 'gallery.visualImageTab'),
    paletteTab: t(locale, 'gallery.visualPaletteTab'),
    chooseImage: t(locale, 'gallery.visualChooseImage'),
    combined: t(locale, 'gallery.visualCombined'),
    combinedHelp: t(locale, 'gallery.visualCombinedHelp'),
    nearDuplicate: t(locale, 'gallery.visualNearDuplicate'),
    nearDuplicateHelp: t(locale, 'gallery.visualNearDuplicateHelp'),
    semantic: t(locale, 'gallery.visualSemantic'),
    semanticHelp: t(locale, 'gallery.visualSemanticHelp'),
    range: t(locale, 'gallery.visualRange'),
    rangePrecise: t(locale, 'gallery.visualRangePrecise'),
    rangeBroad: t(locale, 'gallery.visualRangeBroad'),
    rangeHelp: t(locale, 'gallery.visualRangeHelp'),
    search: t(locale, 'gallery.visualSearch'),
    searching: t(locale, 'gallery.visualSearching'),
    reset: t(locale, 'gallery.visualReset'),
    matches: t(locale, 'gallery.visualMatches', { count: '{count}' }),
    failed: t(locale, 'gallery.visualFailed'),
  };
}
