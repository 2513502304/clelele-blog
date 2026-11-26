import { useTranslation } from '@hooks/useTranslation';
import { releasePeriod, stateColor } from '@lib/hpoi/releases';
import { useMemo, useState } from 'react';
import type { HpoiCollectionItem, HpoiCollectionState } from '@/types/hpoi';
import './release-calendar.css';

export function HpoiReleaseCalendar({
  items,
  state,
  membership,
  complete,
  failed,
  retry,
}: {
  items: HpoiCollectionItem[];
  state: HpoiCollectionState;
  membership: Map<string, HpoiCollectionState>;
  complete: boolean;
  failed: boolean;
  retry: () => void;
}) {
  const { locale, t } = useTranslation();
  const dates = useMemo(() => items.map((item) => ({ item, ...releasePeriod(item) })), [items]);
  const months = useMemo(() => [...new Set(dates.map((d) => d.month).filter(Boolean))].sort(), [dates]);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const current = today.slice(0, 7);
  const [chosen, setChosen] = useState(''),
    [day, chooseDay] = useState(0),
    [unknown, showUnknown] = useState(false);
  const month = chosen || months.find((m) => m >= current) || months.at(-1) || current;
  const start = new Date(`${month}-01T12:00:00Z`);
  const dateLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(start);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  const offset = (start.getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const releases = dates.filter((d) => d.month === month),
    undated = dates.filter((d) => !d.month);
  const listed = unknown
    ? undated
    : releases.filter((d) => !day || d.day === day).sort((a, b) => (a.day || 32) - (b.day || 32));
  function go(value: string) {
    setChosen(value);
    chooseDay(0);
    showUnknown(false);
  }
  function step(n: number) {
    const next = new Date(start);
    next.setUTCMonth(next.getUTCMonth() + n);
    go(next.toISOString().slice(0, 7));
  }
  const days = new Map<number, number>();
  for (const d of releases) if (d.day) days.set(d.day, (days.get(d.day) ?? 0) + 1);
  return (
    <section className="hpoi-calendar" aria-label={t('hpoi.calendar')}>
      <div className="hpoi-calendar-month">
        <div className="hpoi-calendar-tools">
          <h2>{t('hpoi.calendar')}</h2>
          <div>
            <button type="button" aria-label={t('hpoi.previousMonth')} onClick={() => step(-1)}>
              ‹
            </button>
            <select aria-label={t('hpoi.releaseMonth')} value={month} onChange={(e) => go(e.currentTarget.value)}>
              {[...new Set([...months, month, current])].sort().map((m) => (
                <option key={m} value={m}>
                  {new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
                    new Date(`${m}-01T12:00:00Z`),
                  )}
                </option>
              ))}
            </select>
            <button type="button" aria-label={t('hpoi.nextMonth')} onClick={() => step(1)}>
              ›
            </button>
          </div>
        </div>
        <div className="hpoi-days">
          {Array.from({ length: 7 }, (_, i) => Date.UTC(2024, 0, 1 + i)).map((stamp) => (
            <span className="hpoi-weekday" key={stamp}>
              {weekday.format(stamp)}
            </span>
          ))}
          {Array.from({ length }, (_, i) => i + 1).map((d) => (
            <button
              type="button"
              key={d}
              style={d === 1 ? { gridColumnStart: offset + 1 } : undefined}
              disabled={!days.has(d)}
              aria-pressed={!unknown && day === d}
              aria-label={`${month}-${String(d).padStart(2, '0')} · ${days.get(d) ?? 0}`}
              onClick={() => {
                chooseDay(day === d ? 0 : d);
                showUnknown(false);
              }}
            >
              {d}
              {days.has(d) && <i aria-hidden="true" />}
            </button>
          ))}
        </div>
      </div>
      <div className="hpoi-agenda">
        <div className="hpoi-agenda-tools">
          <h3>{unknown ? t('hpoi.undated') : day ? `${month}-${String(day).padStart(2, '0')}` : dateLabel}</h3>
          <button
            type="button"
            aria-pressed={!unknown && !day}
            onClick={() => {
              showUnknown(false);
              chooseDay(0);
            }}
          >
            {t('hpoi.wholeMonth')} · {releases.length}
          </button>
          <button type="button" aria-pressed={unknown} onClick={() => showUnknown(true)}>
            {t('hpoi.undated')} · {undated.length}
          </button>
        </div>
        {failed && (
          <button type="button" onClick={retry}>
            {t('hpoi.retry')}
          </button>
        )}
        {!complete && !failed && <output>{t('common.loading')}</output>}
        {complete && !listed.length && <p className="py-5 text-muted-foreground text-sm">{t('hpoi.noItems')}</p>}
        <ul>
          {listed.map(({ item }) => {
            const status = state === 'all' ? membership.get(item.id) : state;
            return (
              <li key={item.id} style={{ borderColor: stateColor[status ?? 'all'] }}>
                <a href={item.detailUrl} target="_blank" rel="noopener noreferrer">
                  <strong>{item.title}</strong>
                  <small>
                    {item.releaseText || t('hpoi.undated')}
                    {status && <> · {t(`hpoi.${status}`)}</>}
                  </small>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
