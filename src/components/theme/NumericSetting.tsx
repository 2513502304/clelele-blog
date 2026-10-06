import { useEffect, useState } from 'react';
import { usePointerRange } from '@/hooks/usePointerRange';

/** Allow incomplete numeric typing; update valid values live and clamp the remaining draft only on blur. */
export function NumericSetting({
  name,
  value,
  min,
  max,
  step,
  suffix = '',
  onChange,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const range = usePointerRange(onChange);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <div className="appearance-numeric">
      <label>
        <span>{name}</span>
        <span>
          <input
            type="number"
            aria-label={name}
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
      </label>
      <input type="range" aria-label={`${name} slider`} min={min} max={max} step={step} value={value} {...range} />
    </div>
  );
}
