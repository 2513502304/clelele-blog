import { useEffect, useId, useState } from 'react';
import { usePointerRange } from '@/hooks/usePointerRange';
import { SettingHelp } from './SettingHelp';
import type { HelpKey, HelpLanguage } from './setting-help-copy';

/** Allow incomplete numeric typing; update valid values live and clamp the remaining draft only on blur. */
export function NumericSetting({
  name,
  value,
  min,
  max,
  step,
  suffix = '',
  help,
  onChange,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  help: { setting: HelpKey; lang: HelpLanguage };
  onChange: (value: number) => void;
}) {
  const range = usePointerRange(onChange);
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div className="appearance-numeric">
      <div className="appearance-numeric-heading">
        <span className="setting-label">
          <label htmlFor={id}>{name}</label>
          <SettingHelp label={name} {...help} />
        </span>
        <span>
          <input
            id={id}
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              const number = event.currentTarget.valueAsNumber;
              if (Number.isFinite(number) && number >= min && number <= max) onChange(number);
            }}
            onBlur={() => {
              const number = draft.trim() ? Number(draft) : value;
              const next = Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : value;
              setDraft(String(next));
              onChange(next);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          {suffix}
        </span>
      </div>
      <input type="range" aria-label={`${name} slider`} min={min} max={max} step={step} value={value} {...range} />
    </div>
  );
}
