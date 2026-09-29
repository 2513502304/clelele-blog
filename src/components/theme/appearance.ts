/** Palettes change color and typography only; navigation, image rendering and Gallery data stay untouched. */
export const APPEARANCES = [
  { id: 'original', zh: '原色日常', en: 'Original', ja: 'オリジナル', color: '#f5dfe5', ink: '#bc5268' },
  { id: 'sakura', zh: '花间手记', en: 'Sakura', ja: '桜日記', color: '#f7e0e9', ink: '#a23f66' },
  { id: 'paper', zh: '纸上画廊', en: 'Paper', ja: '紙の画廊', color: '#eee8da', ink: '#5f584a' },
  { id: 'sage', zh: '林间书屋', en: 'Sage', ja: '森の書斎', color: '#e2e9dc', ink: '#4c6947' },
  { id: 'ocean', zh: '海盐来信', en: 'Sea salt', ja: '海の便り', color: '#dcebf0', ink: '#346e85' },
  { id: 'lavender', zh: '紫藤小院', en: 'Wisteria', ja: '藤の庭', color: '#e9e1f2', ink: '#725393' },
  { id: 'amber', zh: '琥珀午后', en: 'Amber', ja: '琥珀の午後', color: '#f5e7cd', ink: '#846022' },
  { id: 'rosewood', zh: '玫瑰木', en: 'Rosewood', ja: 'ローズウッド', color: '#ecddd8', ink: '#875747' },
  { id: 'graphite', zh: '铅笔与墨', en: 'Graphite', ja: '鉛筆と墨', color: '#e4e4e2', ink: '#515451' },
  { id: 'blueprint', zh: '蓝调印刷', en: 'Blueprint', ja: '青い印刷', color: '#dee5f2', ink: '#425d91' },
] as const;
export type Appearance = (typeof APPEARANCES)[number]['id'];
export type TextSize = 'standard' | 'comfort' | 'large';
let activeTransition: ViewTransition | undefined;
let sequence = 0;

/** Cancel older snapshots on rapid changes; reduced-motion and older browsers receive the same final state. */
export function setAppearance(appearance: Appearance, textSize: TextSize, animate = true) {
  const root = document.documentElement;
  const id = ++sequence;
  activeTransition?.skipTransition();
  const apply = () => {
    if (id !== sequence) return;
    root.dataset.appearance = appearance;
    root.dataset.textSize = textSize;
    try {
      localStorage.setItem('appearance', appearance);
      localStorage.setItem('appearance-text-size', textSize);
    } catch {
      /* Browser privacy settings may disable storage; the current page still works. */
    }
    window.dispatchEvent(new Event('appearance-change'));
  };
  if (!animate || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.classList.remove('appearance-transition');
    apply();
    return;
  }
  root.classList.add('appearance-transition');
  activeTransition = document.startViewTransition(apply);
  void activeTransition.finished
    .catch(() => {})
    .finally(() => {
      if (id === sequence) {
        root.classList.remove('appearance-transition');
        activeTransition = undefined;
      }
    });
}
