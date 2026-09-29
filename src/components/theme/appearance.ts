import { DEFAULT_READING, getReadingPreferences, setReadingPreferences } from './reading-preferences';
/** Palettes change color and typography only; navigation, image rendering and Gallery data stay untouched. */
export const APPEARANCES = [
  { id: 'original', zh: '原色日常', en: 'Original', ja: 'オリジナル', color: '#f5dfe5', ink: '#bc5268' },
  { id: 'sakura', zh: '花间手记', en: 'Sakura', ja: '桜日記', color: '#f3cedd', ink: '#a23f66' },
  { id: 'paper', zh: '纸上画廊', en: 'Paper', ja: '紙の画廊', color: '#eaddcb', ink: '#5f584a' },
  { id: 'sage', zh: '林间书屋', en: 'Sage', ja: '森の書斎', color: '#d0e2ca', ink: '#4c6947' },
  { id: 'ocean', zh: '海盐来信', en: 'Sea salt', ja: '海の便り', color: '#bee0ef', ink: '#346e85' },
  { id: 'lavender', zh: '紫藤小院', en: 'Wisteria', ja: '藤の庭', color: '#dbc9ed', ink: '#725393' },
  { id: 'amber', zh: '琥珀午后', en: 'Amber', ja: '琥珀の午後', color: '#f4daaf', ink: '#846022' },
  { id: 'rosewood', zh: '玫瑰木', en: 'Rosewood', ja: 'ローズウッド', color: '#dbb9af', ink: '#875747' },
  { id: 'graphite', zh: '铅笔与墨', en: 'Graphite', ja: '鉛筆と墨', color: '#d6d7d5', ink: '#515451' },
  { id: 'blueprint', zh: '蓝调印刷', en: 'Blueprint', ja: '青い印刷', color: '#a8bee6', ink: '#425d91' },
  { id: 'mint', zh: '薄荷汽水', en: 'Mint soda', ja: 'ミントソーダ', color: '#b9e9d8', ink: '#226b55' },
  { id: 'lemon', zh: '柠檬奶油', en: 'Lemon cream', ja: 'レモンクリーム', color: '#f1e8aa', ink: '#68621b' },
  { id: 'peach', zh: '桃杏果园', en: 'Peach orchard', ja: '桃の果樹園', color: '#f6c5aa', ink: '#884528' },
  { id: 'ice', zh: '冰川清晨', en: 'Glacier', ja: '氷河の朝', color: '#b4e9ed', ink: '#236f75' },
  { id: 'mulberry', zh: '桑葚果酱', en: 'Mulberry', ja: '桑の実', color: '#e3b3cf', ink: '#79345f' },
  { id: 'sand', zh: '沙丘旅人', en: 'Dunes', ja: '砂丘の旅', color: '#dac3a3', ink: '#6c512d' },
  { id: 'pistachio', zh: '开心果绿', en: 'Pistachio', ja: 'ピスタチオ', color: '#dce4ad', ink: '#526128' },
  { id: 'moonlight', zh: '月下石阶', en: 'Moonstone', ja: '月下の石段', color: '#c2c9de', ink: '#46547b' },
] as const;
export type Appearance = (typeof APPEARANCES)[number]['id'];
let activeTransition: ViewTransition | undefined;
let sequence = 0;

/** Cancel older snapshots on rapid changes; reduced-motion and older browsers receive the same final state. */
export function setAppearance(appearance: Appearance, animate = true) {
  const root = document.documentElement;
  const id = ++sequence;
  activeTransition?.skipTransition();
  const apply = () => {
    if (id !== sequence) return;
    root.dataset.appearance = appearance;
    try {
      localStorage.setItem('appearance', appearance);
    } catch {
      /* Browser privacy settings may disable storage; the current page still works. */
    }
    window.dispatchEvent(new Event('appearance-change'));
  };
  if (
    !animate ||
    getReadingPreferences().motion === 'reduced' ||
    !document.startViewTransition ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    root.classList.remove('appearance-transition', 'appearance-updated');
    apply();
    return;
  }
  root.style.setProperty('--appearance-scroll-y', `${-window.scrollY}px`);
  // The page snapshot paints above live DOM. Cut a window around the uncaptured settings portal;
  // naming/capturing the panel itself would once again disable its native pointer hit testing.
  const panel = document.querySelector('.appearance-panel')?.getBoundingClientRect();
  let clip = 'none';
  if (panel) {
    const l = panel.left - 2,
      t = panel.top - 2,
      r = panel.right + 2,
      b = panel.bottom + 2,
      c = 26;
    clip = `path(evenodd, "M0 0H${innerWidth}V${innerHeight}H0Z M${l + c} ${t}H${r - c}Q${r} ${t} ${r} ${t + c}V${b - c}Q${r} ${b} ${r - c} ${b}H${l + c}Q${l} ${b} ${l} ${b - c}V${t + c}Q${l} ${t} ${l + c} ${t}Z")`;
  }
  root.style.setProperty('--appearance-clip', clip);
  root.classList.remove('appearance-updated');
  root.classList.add('appearance-transition');
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => {
      apply();
      if (id === sequence) root.classList.add('appearance-updated');
    });
  } catch {
    // Animation is optional: a snapshot startup failure must not lose the chosen palette.
    root.classList.remove('appearance-transition', 'appearance-updated');
    activeTransition = undefined;
    apply();
    return;
  }
  activeTransition = transition;
  const cancel = () => transition.skipTransition();
  // A moved panel or viewport invalidates snapshot geometry; finish immediately instead of showing stale pixels.
  const panelElement = document.querySelector('.appearance-panel');
  panelElement?.addEventListener('pointerdown', cancel);
  window.addEventListener('scroll', cancel, { passive: true });
  window.addEventListener('resize', cancel);
  void transition.finished
    .catch(() => {})
    .finally(() => {
      panelElement?.removeEventListener('pointerdown', cancel);
      window.removeEventListener('scroll', cancel);
      window.removeEventListener('resize', cancel);
      if (id === sequence) {
        root.classList.remove('appearance-transition', 'appearance-updated');
        activeTransition = undefined;
      }
    });
}

/** Reset reading independently of light/dark mode, without replaying an in-flight snapshot. */
export function resetAppearance() {
  setReadingPreferences(DEFAULT_READING);
  setAppearance('original', false);
}
